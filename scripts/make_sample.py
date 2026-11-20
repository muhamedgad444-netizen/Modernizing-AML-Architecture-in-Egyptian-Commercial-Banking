"""Builds public/sample_ibm_aml.csv: a small real sample of IBM AMLworld HI-Small (memory-light, 2 passes)."""
import csv
import random

random.seed(7)
SRC = 'data/HI-Small_Trans.csv'

# Pass 1: collect illicit rows, pick ~200 illicit accounts, reservoir-sample benign rows.
ill = []
reservoir, seen = [], 0
with open(SRC, newline='') as f:
    r = csv.reader(f)
    hdr = next(r)
    for row in r:
        if row[-1] == '1':
            ill.append(row)
        else:
            seen += 1
            if len(reservoir) < 12000:
                reservoir.append(row)
            else:
                j = random.randrange(seen)
                if j < 12000:
                    reservoir[j] = row
print('illicit', len(ill), 'benign', seen)

random.shuffle(ill)
keep_acc, keep = set(), []
for row in ill:
    if len(keep_acc) >= 200:
        break
    keep.append(row)
    keep_acc.update([row[2], row[4]])

# Pass 2: benign rows touching the chosen illicit accounts.
touch = []
with open(SRC, newline='') as f:
    r = csv.reader(f)
    next(r)
    for row in r:
        if row[-1] == '0' and (row[2] in keep_acc or row[4] in keep_acc):
            touch.append(row)
            if len(touch) >= 8000:
                break

rows = sorted({tuple(x) for x in keep + touch + reservoir})
with open('public/sample_ibm_aml.csv', 'w', newline='') as o:
    w = csv.writer(o)
    w.writerow(hdr)
    w.writerows(rows)
print('rows', len(rows))
