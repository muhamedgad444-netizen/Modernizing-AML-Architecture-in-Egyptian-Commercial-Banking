import { Account, PaymentChannel, PeerGroup, Transaction } from './types';

// Deterministic Mulberry32 PRNG for reproducible benchmarks
export class SeededRNG {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

const EGYPTIAN_BANKS = ['NBE', 'CIB', 'Banque Misr', 'QNB Alahli', 'AAIB', 'AlexBank'];
const GOVERNORATES = ['Cairo', 'Giza', 'Alexandria', 'Mansoura', 'Tanta', 'Suez', 'Asyut'];

const MERCHANT_NAMES = [
  'El-Abd Patisserie Supply',
  'Al-Azhar Textile Trading',
  'Nile Electronics Wholesale',
  'Maadi Organic Grocers',
  'Alexandria Marine Foods',
  'Heliopolis Pharma Dist.',
  'Nasr City Auto Parts',
  'Zamalek Roastery Co.',
  'Giza Construction Materials',
  'Tanta Spice & Grain Co.',
  'Dokki Furniture Gallery',
  'Mohandessin Apparel Hub',
  '6th Oct Packaging Ltd',
  'Shubra Steel & Hardware',
  'Mansoura Dairy Logistics',
  'Smouha Optics & Medical',
  'New Cairo Catering Co.',
  'Suez Freight & Customs',
  'Badr City Plastics',
  'Obour Wholesale Produce',
  'Faisal Mobile Accessories',
  'Haram Appliances Mart',
  'Shorouk Building Supply',
  'Rehab Home Essentials',
  'Port Said Import Hub',
  'Ismailia Agro Exports',
  'Luxor Hospitality Supply',
  'Hurghada Dive & Resort',
];

const RETAIL_FIRST = [
  'Ahmed', 'Mohamed', 'Mahmoud', 'Omar', 'Youssef', 'Karim', 'Tarek', 'Hossam',
  'Mostafa', 'Khaled', 'Nour', 'Salma', 'Mariam', 'Farah', 'Heba', 'Dina',
  'Nadia', 'Yasmine', 'Ramy', 'Sherif', 'Amr', 'Wael', 'Samy', 'Hany',
];

const RETAIL_LAST = [
  'El-Sayed', 'Hassan', 'Ibrahim', 'Mansour', 'Fathy', 'Nabil', 'Soliman',
  'Abdelrahman', 'Zaki', 'Gaber', 'Metwally', 'Shaker', 'Kamel', 'El-Masry',
  'Farouk', 'Rashed', 'Salem', 'Hegazy', 'Shawky', 'Lotfy',
];

export interface SimulatedDataset {
  accounts: Account[];
  transactions: Transaction[];
  baseTimestamp: number;
}

export function generateEgyptianBankingDataset(seed = 20261120): SimulatedDataset {
  const rng = new SeededRNG(seed);
  const accounts: Account[] = [];
  const transactions: Transaction[] = [];

  // Anchor around Nov 20, 2026 00:00 Cairo time
  const baseTimestamp = new Date('2026-11-15T00:00:00+02:00').getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;

  let txCounter = 1;
  const mkTxId = () => `IPN-${String(txCounter++).padStart(6, '0')}`;

  // 1. Seasonal Merchants (28 accounts) — high legitimate volume, frequently trip 50k/100k legacy rules
  for (let i = 0; i < MERCHANT_NAMES.length; i++) {
    const name = MERCHANT_NAMES[i];
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/\.$/, '');
    accounts.push({
      id: `ACC-M${String(i + 1).padStart(3, '0')}`,
      name,
      handle: `${slug}@instapay`,
      bank: rng.pick(EGYPTIAN_BANKS),
      governorate: rng.pick(GOVERNORATES),
      peerGroup: 'seasonal_merchant',
      kycDocType: 'Segel Togary (Tax Card)',
      accountAgeDays: rng.int(420, 2100),
      declaredMonthlyIncomeEGP: rng.int(450000, 1800000),
      deviceId: `DEV-M-${String(i + 1).padStart(3, '0')}`,
      ipSubnet: `197.${rng.int(32, 60)}.${rng.int(1, 250)}.0/24`,
      proxyPhone: `+2010${rng.int(10000000, 99999999)}`,
      groundTruth: 'benign_seasonal_merchant',
      isIllicit: false,
    });
  }

  // 2. SME Corporate / Payroll Accounts (14 accounts) — trip 100k daily rules on payroll runs
  for (let i = 0; i < 14; i++) {
    accounts.push({
      id: `ACC-C${String(i + 1).padStart(3, '0')}`,
      name: `Delta Tech & Services #${i + 1} SAE`,
      handle: `corp.payroll${i + 1}@instapay`,
      bank: rng.pick(EGYPTIAN_BANKS),
      governorate: rng.pick(['Cairo', 'Giza', 'Alexandria']),
      peerGroup: 'sme_corporate',
      kycDocType: 'Segel Togary (Tax Card)',
      accountAgeDays: rng.int(500, 2500),
      declaredMonthlyIncomeEGP: rng.int(900000, 3200000),
      deviceId: `DEV-C-${String(i + 1).padStart(3, '0')}`,
      ipSubnet: `41.${rng.int(128, 190)}.${rng.int(1, 250)}.0/24`,
      proxyPhone: `+2012${rng.int(10000000, 99999999)}`,
      groundTruth: 'benign_normal',
      isIllicit: false,
    });
  }

  // 3. Salaried Retail & Student/Family Accounts (54 accounts)
  // ~18 of these will make a legitimate car down-payment or university tuition payment >= 50k EGP
  for (let i = 0; i < 54; i++) {
    const fn = rng.pick(RETAIL_FIRST);
    const ln = rng.pick(RETAIL_LAST);
    const isTuitionOrAsset = i < 18;
    const peerGroup: PeerGroup = i % 3 === 0 ? 'student_family' : 'salaried_retail';
    accounts.push({
      id: `ACC-R${String(i + 1).padStart(3, '0')}`,
      name: `${fn} ${ln}`,
      handle: `${fn.toLowerCase()}.${ln.toLowerCase().replace(/[^a-z]/g, '')}${i}@instapay`,
      bank: rng.pick(EGYPTIAN_BANKS),
      governorate: rng.pick(GOVERNORATES),
      peerGroup,
      kycDocType: isTuitionOrAsset ? 'National ID' : 'Payroll Letter',
      accountAgeDays: rng.int(240, 1900),
      declaredMonthlyIncomeEGP: rng.int(18000, 95000),
      deviceId: `DEV-R-${String(i + 1).padStart(3, '0')}`,
      ipSubnet: `156.${rng.int(192, 223)}.${rng.int(1, 250)}.0/24`,
      proxyPhone: `+2011${rng.int(10000000, 99999999)}`,
      groundTruth: isTuitionOrAsset ? 'benign_tuition_or_asset' : 'benign_normal',
      isIllicit: false,
    });
  }

  // 4. ILLICIT SYNDICATE #1: InstaPay Smurfing Mule Ring (14 mules + 2 collectors = 16 accounts)
  // Matches the MD illustrative example: ~950,000 EGP split into ~100 micro-transfers of ~9,500 EGP
  // staying strictly below 50,000 EGP single and 100,000 EGP daily rules!
  const sharedMuleDevices = ['MAC-SYN-99A1', 'MAC-SYN-99B2', 'MAC-SYN-99C3'];
  const sharedMuleSubnets = ['197.168.77.0/24', '197.168.78.0/24'];
  const muleIds: string[] = [];
  const collectorIds: string[] = [];

  for (let i = 0; i < 14; i++) {
    const fn = rng.pick(RETAIL_FIRST);
    const ln = rng.pick(RETAIL_LAST);
    const id = `ACC-ML${String(i + 1).padStart(2, '0')}`;
    muleIds.push(id);
    accounts.push({
      id,
      name: `${fn} ${ln} (Mule #${i + 1})`,
      handle: `wallet.m${i + 1}@instapay`,
      bank: rng.pick(EGYPTIAN_BANKS),
      governorate: rng.pick(['Giza', 'Cairo', 'Qalyubia']),
      peerGroup: 'mule_account',
      kycDocType: 'National ID',
      accountAgeDays: rng.int(6, 38), // recently opened/activated!
      declaredMonthlyIncomeEGP: rng.int(6000, 14000),
      deviceId: sharedMuleDevices[i % sharedMuleDevices.length], // shared MAC/IMEI
      ipSubnet: sharedMuleSubnets[i % sharedMuleSubnets.length], // shared IP subnet
      proxyPhone: `+20155000010${i % 3}`,
      groundTruth: 'illicit_smurfing_mule',
      isIllicit: true,
    });
  }

  for (let i = 0; i < 2; i++) {
    const id = `ACC-CL${String(i + 1).padStart(2, '0')}`;
    collectorIds.push(id);
    accounts.push({
      id,
      name: i === 0 ? 'Al-Waha Shell Imports' : 'Red Sea Cashout Hub',
      handle: `collector.hub${i + 1}@instapay`,
      bank: i === 0 ? 'CIB' : 'NBE',
      governorate: 'Cairo',
      peerGroup: 'collector_account',
      kycDocType: 'Segel Togary (Tax Card)',
      accountAgeDays: rng.int(12, 45),
      declaredMonthlyIncomeEGP: 45000,
      deviceId: sharedMuleDevices[0],
      ipSubnet: sharedMuleSubnets[0],
      proxyPhone: '+201550000100',
      groundTruth: 'illicit_smurfing_collector',
      isIllicit: true,
    });
  }

  // 5. ILLICIT SYNDICATE #2: Multi-Hop Cyclic Layering Ring (5 accounts)
  // A -> B -> C -> D -> E -> A passing sub-threshold amounts rapidly to obscure origin
  const cycleIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const id = `ACC-CY${String(i + 1).padStart(2, '0')}`;
    cycleIds.push(id);
    accounts.push({
      id,
      name: `Layering Node ${String.fromCharCode(65 + i)} (${rng.pick(RETAIL_LAST)})`,
      handle: `layer.node${i + 1}@instapay`,
      bank: rng.pick(EGYPTIAN_BANKS),
      governorate: 'Alexandria',
      peerGroup: 'mule_account',
      kycDocType: 'National ID',
      accountAgeDays: rng.int(10, 50),
      declaredMonthlyIncomeEGP: 15000,
      deviceId: i < 3 ? 'MAC-CYC-44X1' : 'MAC-CYC-44X2',
      ipSubnet: '197.201.99.0/24',
      proxyPhone: '+201559990001',
      groundTruth: 'illicit_cyclic_layering',
      isIllicit: true,
    });
  }

  // --- GENERATE TRANSACTIONS OVER 5 DAYS ---
  const merchantAccs = accounts.filter((a) => a.peerGroup === 'seasonal_merchant');
  const corpAccs = accounts.filter((a) => a.peerGroup === 'sme_corporate');
  const retailAccs = accounts.filter(
    (a) => a.peerGroup === 'salaried_retail' || a.peerGroup === 'student_family'
  );

  // A. Normal Merchant activity (daytime 09:00-20:00, regular counterparties, seasonal spikes >= 50k EGP)
  for (const m of merchantAccs) {
    const fixedSuppliers = [
      rng.pick(corpAccs),
      rng.pick(merchantAccs.filter((x) => x.id !== m.id)),
      rng.pick(merchantAccs.filter((x) => x.id !== m.id)),
    ];
    for (let day = 0; day < 5; day++) {
      const txPerDay = rng.int(3, 6);
      for (let t = 0; t < txPerDay; t++) {
        const hour = rng.range(9, 20);
        const ts = baseTimestamp + day * DAY_MS + hour * HOUR_MS;
        const counterparty = rng.pick(fixedSuppliers);
        // Legitimate seasonal surge: ~35% of merchant transfers cross 50,000 EGP
        const isSurge = rng.next() < 0.35;
        const amount = isSurge ? Math.round(rng.range(52000, 88000)) : Math.round(rng.range(12000, 38000));
        transactions.push({
          id: mkTxId(),
          fromAccountId: m.id,
          toAccountId: counterparty.id,
          amountEGP: amount,
          timestamp: ts,
          channel: amount > 60000 ? 'ACH_WIRE' : 'IPN_INSTAPAY',
          deviceId: m.deviceId,
          ipSubnet: m.ipSubnet,
          note: isSurge ? 'Seasonal inventory restock' : 'Routine supplier settlement',
          scenarioTag: 'seasonal_merchant',
        });
      }
    }
  }

  // B. SME Corporate payroll & B2B settlements (daytime 09:00-17:00)
  for (const c of corpAccs) {
    for (let day = 0; day < 5; day++) {
      const recipients = [rng.pick(retailAccs), rng.pick(retailAccs), rng.pick(merchantAccs)];
      for (const r of recipients) {
        const hour = rng.range(9, 17);
        const ts = baseTimestamp + day * DAY_MS + hour * HOUR_MS;
        const isPayroll = day === 2;
        const amount = isPayroll ? Math.round(rng.range(38000, 62000)) : Math.round(rng.range(14000, 32000));
        transactions.push({
          id: mkTxId(),
          fromAccountId: c.id,
          toAccountId: r.id,
          amountEGP: amount,
          timestamp: ts,
          channel: 'ACH_WIRE',
          deviceId: c.deviceId,
          ipSubnet: c.ipSubnet,
          note: isPayroll ? 'Monthly payroll & vendor disbursement' : 'B2B invoice payment',
          scenarioTag: 'corporate_payroll',
        });
      }
    }
  }

  // C. Retail & Student/Family activity (daytime 08:00-22:00)
  for (const r of retailAccs) {
    const regularMerchants = [rng.pick(merchantAccs), rng.pick(merchantAccs)];
    for (let day = 0; day < 5; day++) {
      const txPerDay = rng.int(1, 3);
      for (let t = 0; t < txPerDay; t++) {
        const hour = rng.range(8, 22);
        const ts = baseTimestamp + day * DAY_MS + hour * HOUR_MS;
        const target = rng.pick(regularMerchants);
        const amount = Math.round(rng.range(450, 4800));
        transactions.push({
          id: mkTxId(),
          fromAccountId: r.id,
          toAccountId: target.id,
          amountEGP: amount,
          timestamp: ts,
          channel: rng.next() < 0.65 ? 'IPN_INSTAPAY' : 'MOBILE_WALLET',
          deviceId: r.deviceId,
          ipSubnet: r.ipSubnet,
          note: 'Everyday retail purchase',
          scenarioTag: 'retail_normal',
        });
      }
    }

    // Legitimate one-off high-value event (car down-payment or university tuition >= 50k EGP)
    if (r.groundTruth === 'benign_tuition_or_asset') {
      const target = rng.pick(corpAccs);
      const ts = baseTimestamp + rng.int(1, 4) * DAY_MS + rng.range(10, 15) * HOUR_MS;
      const isTuition = r.peerGroup === 'student_family';
      transactions.push({
        id: mkTxId(),
        fromAccountId: r.id,
        toAccountId: target.id,
        amountEGP: isTuition ? Math.round(rng.range(54000, 78000)) : Math.round(rng.range(65000, 125000)),
        timestamp: ts,
        channel: 'IPN_INSTAPAY',
        deviceId: r.deviceId,
        ipSubnet: r.ipSubnet,
        note: isTuition ? 'University Fall Tuition Payment' : 'Vehicle Down-Payment Transfer',
        scenarioTag: isTuition ? 'tuition_payment' : 'car_downpayment',
      });
    }
  }

  // D. ILLICIT SMURFING RING (~950,000 EGP split into ~100 transfers of ~9,500 EGP)
  // Spread across 14 mule accounts over 5 days -> each mule stays strictly < 50k single and < 40k daily!
  // Collectors receive from many mules via sub-threshold transfers; mules forward rapidly within 4-12 mins!
  const muleAccs = accounts.filter((a) => muleIds.includes(a.id));
  const collectorAccs = accounts.filter((a) => collectorIds.includes(a.id));

  for (let day = 0; day < 5; day++) {
    for (let mIdx = 0; mIdx < muleAccs.length; mIdx++) {
      const mule = muleAccs[mIdx];
      const collector = collectorAccs[mIdx % collectorAccs.length];
      const feeder = muleAccs[(mIdx + 3) % muleAccs.length];

      // 1-2 sub-threshold waves per mule per day (total ~100 transfers across 5 days)
      const waves = day % 2 === 0 ? 2 : 1;
      for (let w = 0; w < waves; w++) {
        // Off-hours circadian pattern: 01:00 - 04:30 AM
        const hour = rng.range(1.0, 4.5);
        const tsIn = baseTimestamp + day * DAY_MS + hour * HOUR_MS;
        const amt = Math.round(rng.range(9100, 9850)); // Classic 9,500 EGP smurfing band!

        // Incoming micro-transfer to mule
        transactions.push({
          id: mkTxId(),
          fromAccountId: feeder.id,
          toAccountId: mule.id,
          amountEGP: amt,
          timestamp: tsIn,
          channel: w % 2 === 0 ? 'IPN_INSTAPAY' : 'MOBILE_WALLET',
          deviceId: mule.deviceId,
          ipSubnet: mule.ipSubnet,
          note: 'IPN P2P transfer',
          scenarioTag: 'smurfing_ring',
        });

        // Rapid pass-through forwarding to collector within 3-11 minutes
        const delayMs = rng.range(3, 11) * 60 * 1000;
        transactions.push({
          id: mkTxId(),
          fromAccountId: mule.id,
          toAccountId: collector.id,
          amountEGP: amt - rng.int(20, 90),
          timestamp: tsIn + delayMs,
          channel: 'IPN_INSTAPAY',
          deviceId: mule.deviceId,
          ipSubnet: mule.ipSubnet,
          note: 'IPN P2P transfer',
          scenarioTag: 'smurfing_ring',
        });
      }
    }
  }

  // E. ILLICIT MULTI-HOP CYCLIC LAYERING (A -> B -> C -> D -> E -> A)
  // 4 rapid cycles over 5 days, amounts ~18,500 - 22,500 EGP (well below 50k/100k rules!)
  const cycleAccs = accounts.filter((a) => cycleIds.includes(a.id));
  for (let round = 0; round < 4; round++) {
    let ts = baseTimestamp + (round + 1) * DAY_MS + rng.range(2.0, 4.0) * HOUR_MS;
    let amt = Math.round(rng.range(19500, 23000));
    for (let i = 0; i < cycleAccs.length; i++) {
      const src = cycleAccs[i];
      const dst = cycleAccs[(i + 1) % cycleAccs.length];
      transactions.push({
        id: mkTxId(),
        fromAccountId: src.id,
        toAccountId: dst.id,
        amountEGP: amt,
        timestamp: ts,
        channel: 'IPN_INSTAPAY',
        deviceId: src.deviceId,
        ipSubnet: src.ipSubnet,
        note: 'Personal transfer',
        scenarioTag: 'cyclic_layering',
      });
      ts += rng.range(4, 9) * 60 * 1000;
      amt = Math.max(15000, amt - rng.int(120, 350));
    }
  }

  transactions.sort((a, b) => a.timestamp - b.timestamp);

  return {
    accounts,
    transactions,
    baseTimestamp,
  };
}

export function injectLiveScenario(
  dataset: SimulatedDataset,
  scenario: 'smurfing_ring' | 'cyclic_layering' | 'seasonal_merchant_surge'
): { dataset: SimulatedDataset; summary: string; injectedAccountIds: string[] } {
  const rng = new SeededRNG(Date.now() % 100000);
  const accounts = [...dataset.accounts];
  const transactions = [...dataset.transactions];
  const nowTs = dataset.baseTimestamp + 5 * 24 * 60 * 60 * 1000 + rng.range(1, 3) * 3600 * 1000;
  let nextTxNum = transactions.length + 1;
  const mkTxId = () => `IPN-LIVE-${String(nextTxNum++).padStart(5, '0')}`;
  const suffix = String(Math.floor(Math.random() * 90 + 10));

  if (scenario === 'smurfing_ring') {
    const sharedDev = `MAC-LIVE-${suffix}`;
    const sharedIp = `197.199.${suffix}.0/24`;
    const collectorId = `ACC-CL-L${suffix}`;
    const collector: Account = {
      id: collectorId,
      name: `Live Collector Hub #${suffix}`,
      handle: `live.collector${suffix}@instapay`,
      bank: 'CIB',
      governorate: 'Cairo',
      peerGroup: 'collector_account',
      kycDocType: 'Segel Togary (Tax Card)',
      accountAgeDays: 9,
      declaredMonthlyIncomeEGP: 35000,
      deviceId: sharedDev,
      ipSubnet: sharedIp,
      proxyPhone: `+2015511100${suffix}`,
      groundTruth: 'illicit_smurfing_collector',
      isIllicit: true,
    };
    accounts.push(collector);

    const injectedIds = [collectorId];
    for (let i = 0; i < 6; i++) {
      const muleId = `ACC-ML-L${suffix}-${i + 1}`;
      injectedIds.push(muleId);
      accounts.push({
        id: muleId,
        name: `Live Mule Account ${suffix}-${i + 1}`,
        handle: `live.mule${suffix}.${i + 1}@instapay`,
        bank: rng.pick(EGYPTIAN_BANKS),
        governorate: 'Giza',
        peerGroup: 'mule_account',
        kycDocType: 'National ID',
        accountAgeDays: rng.int(4, 15),
        declaredMonthlyIncomeEGP: 9000,
        deviceId: sharedDev,
        ipSubnet: sharedIp,
        proxyPhone: `+2015511100${suffix}`,
        groundTruth: 'illicit_smurfing_mule',
        isIllicit: true,
      });
    }

    // 3 sub-threshold rapid pass-through transfers per mule across 3 consecutive nights (strictly < 10k EGP each)
    for (let i = 0; i < 6; i++) {
      const muleId = `ACC-ML-L${suffix}-${i + 1}`;
      const feederId = `ACC-ML-L${suffix}-${((i + 2) % 6) + 1}`;
      for (let w = 0; w < 3; w++) {
        const tsIn = nowTs - w * 24 * 3600 * 1000 + i * 180000;
        const amt = Math.round(rng.range(9200, 9750));
        transactions.push({
          id: mkTxId(),
          fromAccountId: feederId,
          toAccountId: muleId,
          amountEGP: amt,
          timestamp: tsIn,
          channel: 'IPN_INSTAPAY',
          deviceId: sharedDev,
          ipSubnet: sharedIp,
          note: 'IPN instant P2P',
          scenarioTag: 'live_smurfing',
        });
        transactions.push({
          id: mkTxId(),
          fromAccountId: muleId,
          toAccountId: collectorId,
          amountEGP: amt - 50,
          timestamp: tsIn + 5 * 60 * 1000,
          channel: 'IPN_INSTAPAY',
          deviceId: sharedDev,
          ipSubnet: sharedIp,
          note: 'IPN instant P2P',
          scenarioTag: 'live_smurfing',
        });
      }
    }

    return {
      dataset: { accounts, transactions, baseTimestamp: dataset.baseTimestamp },
      summary: `Injected live 6-mule + 1-collector InstaPay smurfing ring (~9,500 EGP micro-transfers, shared device ${sharedDev}). Legacy rules: 0 alerts.`,
      injectedAccountIds: injectedIds,
    };
  }

  if (scenario === 'cyclic_layering') {
    const sharedDev = `MAC-CYC-L${suffix}`;
    const sharedIp = `197.211.${suffix}.0/24`;
    const ringIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const id = `ACC-CY-L${suffix}-${i + 1}`;
      ringIds.push(id);
      accounts.push({
        id,
        name: `Live Cycle Node ${suffix}-${i + 1}`,
        handle: `cycle${suffix}.${i + 1}@instapay`,
        bank: rng.pick(EGYPTIAN_BANKS),
        governorate: 'Alexandria',
        peerGroup: 'mule_account',
        kycDocType: 'National ID',
        accountAgeDays: rng.int(7, 22),
        declaredMonthlyIncomeEGP: 12000,
        deviceId: sharedDev,
        ipSubnet: sharedIp,
        proxyPhone: `+2015522200${suffix}`,
        groundTruth: 'illicit_cyclic_layering',
        isIllicit: true,
      });
    }

    for (let round = 0; round < 3; round++) {
      let ts = nowTs - round * 20 * 3600 * 1000;
      let amt = 21500;
      for (let i = 0; i < ringIds.length; i++) {
        transactions.push({
          id: mkTxId(),
          fromAccountId: ringIds[i],
          toAccountId: ringIds[(i + 1) % ringIds.length],
          amountEGP: amt,
          timestamp: ts,
          channel: 'IPN_INSTAPAY',
          deviceId: sharedDev,
          ipSubnet: sharedIp,
          note: 'Urgent transfer',
          scenarioTag: 'live_cycle',
        });
        ts += 6 * 60 * 1000;
        amt -= 200;
      }
    }

    return {
      dataset: { accounts, transactions, baseTimestamp: dataset.baseTimestamp },
      summary: `Injected live 4-hop cyclic layering ring (${ringIds.join(' -> ')} -> ${ringIds[0]}) at ~21,500 EGP per hop.`,
      injectedAccountIds: ringIds,
    };
  }

  // Seasonal Merchant Ramadan/Eid Surge (Benign — trips legacy 50k/100k rules, cleared by Tier 1-3!)
  const merchantId = `ACC-M-L${suffix}`;
  const merchant: Account = {
    id: merchantId,
    name: `Al-Sharq Ramadan Confectionery #${suffix}`,
    handle: `alsharq.sweets${suffix}@instapay`,
    bank: 'NBE',
    governorate: 'Cairo',
    peerGroup: 'seasonal_merchant',
    kycDocType: 'Segel Togary (Tax Card)',
    accountAgeDays: 1450,
    declaredMonthlyIncomeEGP: 1250000,
    deviceId: `DEV-M-L${suffix}`,
    ipSubnet: `197.42.${suffix}.0/24`,
    proxyPhone: `+2010998877${suffix}`,
    groundTruth: 'benign_seasonal_merchant',
    isIllicit: false,
  };
  accounts.push(merchant);

  const corpTargets = accounts.filter((a) => a.peerGroup === 'sme_corporate').slice(0, 2);
  for (let d = 0; d < 3; d++) {
    const ts = dataset.baseTimestamp + (d + 2) * 24 * 60 * 60 * 1000 + 13 * 3600 * 1000;
    transactions.push({
      id: mkTxId(),
      fromAccountId: merchantId,
      toAccountId: corpTargets[d % corpTargets.length].id,
      amountEGP: 72500,
      timestamp: ts,
      channel: 'ACH_WIRE',
      deviceId: merchant.deviceId,
      ipSubnet: merchant.ipSubnet,
      note: 'Ramadan wholesale sugar & flour restock',
      scenarioTag: 'live_seasonal_merchant',
    });
  }

  return {
    dataset: { accounts, transactions, baseTimestamp: dataset.baseTimestamp },
    summary: `Injected benign Seasonal Merchant (${merchant.name}) with 72,500 EGP daytime supplier settlements. Legacy rules flag it; AI pipeline clears it!`,
    injectedAccountIds: [merchantId],
  };
}
