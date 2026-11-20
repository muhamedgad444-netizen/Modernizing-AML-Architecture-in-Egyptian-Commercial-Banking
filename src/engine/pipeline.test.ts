import { describe, expect, it } from 'vitest';
import {
  buildHistoricalTrainingSamples,
  runFullAMLPipeline,
} from './pipeline';
import {
  generateEgyptianBankingDataset,
  injectLiveScenario,
} from './simulator';
import {
  extractTier3FeatureVector,
  GradientBoostedAMLClassifier,
} from './tier3Classifier';

describe('Four-Tier Hybrid AI & Graph AML Architecture (CBE / EMLCU)', () => {
  const dataset = generateEgyptianBankingDataset(20261120);
  const result = runFullAMLPipeline(dataset, { phase: 'phase2_hybrid' });

  it('demonstrates legacy rule failure: >90% false-positive rate and blind to smurfing', () => {
    const { legacy } = result.benchmark;
    expect(legacy.totalAlerts).toBeGreaterThan(40);
    expect(legacy.falsePositiveRate).toBeGreaterThanOrEqual(0.9);
    // Legacy rules miss the sub-threshold 9,500 EGP smurfing mules & cyclic layering
    expect(legacy.recall).toBeLessThan(0.25);
  });

  it('achieves >=80% false-positive reduction and <=20% false-positive ratio with the 4-tier AI pipeline', () => {
    const { aiPipeline } = result.benchmark;
    expect(aiPipeline.falsePositiveReductionPct).toBeGreaterThanOrEqual(80);
    expect(aiPipeline.falsePositiveRate).toBeLessThanOrEqual(0.2);
    // Catches mule rings and cyclic layering that legacy rules missed
    expect(aiPipeline.recall).toBeGreaterThanOrEqual(0.9);
    expect(aiPipeline.smurfingRingsDetected).toBeGreaterThanOrEqual(18);
  });

  it('detects multi-hop cyclic routing and shared-device rings in Tier 2', () => {
    expect(result.detectedCycles.length).toBeGreaterThanOrEqual(1);
    const muleAlerts = result.alerts.filter(
      (a) => a.account.groundTruth === 'illicit_smurfing_mule'
    );
    expect(muleAlerts.length).toBe(14);
    for (const m of muleAlerts) {
      expect(m.tier2.sharedDevicePeers).toBeGreaterThan(0);
      expect(m.calibratedRiskScore).toBeGreaterThanOrEqual(0.65);
    }
  });

  it('clears legitimate seasonal merchants that trip legacy 50k/100k rules', () => {
    const merchantAlerts = result.alerts.filter(
      (a) => a.account.groundTruth === 'benign_seasonal_merchant' && a.legacyAlert !== null
    );
    expect(merchantAlerts.length).toBeGreaterThan(15);
    const suppressedMerchants = merchantAlerts.filter(
      (a) => a.triageBand === 'auto_suppressed'
    );
    expect(suppressedMerchants.length / merchantAlerts.length).toBeGreaterThanOrEqual(0.85);
  });

  it('produces locally additive SHAP attributions and Law No. 80 SAR drafts in Tier 4', () => {
    const topAlert = result.alerts[0];
    expect(topAlert.triageBand).toBe('high_risk');
    expect(topAlert.sarDraft).not.toBeNull();
    expect(topAlert.sarDraft!.regulatoryFramework).toBe('CBE / EMLCU Law No. 80');
    expect(topAlert.sarDraft!.narrative).toContain('EMLCU');

    const shapSum = topAlert.shapAttributions.reduce((s, a) => s + a.shapValue, 0);
    expect(topAlert.baseValue + shapSum).toBeCloseTo(topAlert.calibratedRiskScore, 2);
  });

  it('detects live-injected smurfing rings while clearing live-injected seasonal merchant surges', () => {
    const { dataset: dsSmurf, injectedAccountIds: smurfIds } = injectLiveScenario(
      dataset,
      'smurfing_ring'
    );
    const smurfRun = runFullAMLPipeline(dsSmurf, { existingModel: result.model });
    const injectedSmurfAlerts = smurfRun.alerts.filter((a) => smurfIds.includes(a.accountId));
    const caught = injectedSmurfAlerts.filter((a) => a.calibratedRiskScore >= 0.65);
    expect(caught.length).toBe(injectedSmurfAlerts.length);
    // Legacy rules miss the injected smurfing ring completely
    const legacyCaught = injectedSmurfAlerts.filter((a) => a.legacyAlert !== null);
    expect(legacyCaught.length).toBe(0);

    const { dataset: dsMerchant, injectedAccountIds: merchIds } = injectLiveScenario(
      dataset,
      'seasonal_merchant_surge'
    );
    const merchRun = runFullAMLPipeline(dsMerchant, { existingModel: result.model });
    const merchAlert = merchRun.alerts.find((a) => a.accountId === merchIds[0])!;
    expect(merchAlert.legacyAlert).not.toBeNull(); // Legacy rule fires on 72.5k EGP
    expect(merchAlert.triageBand).toBe('auto_suppressed'); // AI pipeline clears it
  });

  it('supports analyst feedback retraining of Tier 3 GBDT', () => {
    const topAlert = result.alerts[0];
    const feedbackSamples = buildHistoricalTrainingSamples([
      {
        features: extractTier3FeatureVector(
          topAlert.account,
          topAlert.tier1,
          topAlert.tier2,
          topAlert.legacyAlert
        ),
        label: 1,
        weight: 3,
      },
    ]);
    const retrained = new GradientBoostedAMLClassifier();
    retrained.fit(feedbackSamples);
    expect(retrained.trainedSampleCount).toBeGreaterThan(result.model.trainedSampleCount);
  });
});
