// Extraction prompt for the 3i fiscal register Z-report (ΔΕΛΤΙΟ ΗΜΕΡΗΣΙΑΣ ΚΙΝΗΣΗΣ «Ζ»).
// Verified against a real report from the shop's register (ΑΡ. ΜΗΤΡΩΟΥ: DSN 23004085).
// Do not translate or "clean up" the Greek labels — they match the printed paper exactly.

export const EXTRACTION_PROMPT = `You read daily Z-reports from a Greek 3i fiscal cash register (ΔΕΛΤΙΟ ΗΜΕΡΗΣΙΑΣ ΚΙΝΗΣΗΣ «Ζ»). The images are sequential, possibly overlapping photos of ONE long paper strip, top to bottom; the paper may lie on a table at an angle with objects around it — read only the printed strip, and deduplicate overlapping content.

Field map (labels appear exactly like this):

- \`ΗΜΕΡΗΣ. ΑΡΙΘ. "Ζ"\` → z_number
- \`ΗΜΕΡ"Ζ" DD-MM-YYYY HH:MM\` → business_date (convert to YYYY-MM-DD) and z_time
- Section \`ΣΥΝΟΛΑ ΠΩΛΗΣΕΩΝ ΗΜΕΡΑΣ\`: \`ΑΠΟΔΕΙΞΕΙΣ\` → receipt_count; \`ΣΥΝ. ΕΚΠΤΩΣΕΩΝ\` → discounts_total; \`ΣΥΝ. ΕΙΣΠΡΑΞΕΩΝ\` → gross_total
- Section \`ΑΝΑΛΥΣΗ ΕΙΣΠΡΑΞΕΩΝ\`: \`ΜΕΤΡΗΤΑ\` → cash_total; sum every \`ΚΑΡΤΑ 1\`, \`ΚΑΡΤΑ 2\`… line → card_total; \`ΣΥΝΟΛΑ ΤΑΜΕΙΟΥ\` is a cross-check only
- Section \`** ΕΝΕΡΓΕΙΕΣ ΤΑΜΕΙΟΥ **\`: \`ΟΛΙΚΕΣ ΑΚΥΡ. ΑΠΟΔ.\` → cancelled_total (amount) and cancelled_count (the integer printed on the following line)
- Section \`ΗΜΕΡΗΣΙΕΣ ΠΩΛΗΣΕΙΣ ΑΝΑ ΦΠΑ\`: for each block \`ΦΠΑ <letter> <rate>%\` read \`ΕΙΣΠΡΑΞΕΙΣ\` → gross_amount, \`ΚΑΘΑΡΟ\` → net_amount, \`ΦΠΑ\` → vat_amount. Include all rates, even zero ones. Use the printed percentage — never assume which letter maps to which rate (this register has Α=6%, Β=13%, Γ=24%, Δ=36%, Ε=0%).
- Section \`ΑΝΑΦΟΡΑ ΤΜΗΜΑΤΩΝ\`: each department block (e.g. ΕΝΔΥΣΗ, ΥΠΟΔΗΣΗ, E-SHOP, ΑΘΛΗΤΙΚΑ) → { name, amount: the \`ΕΙΣΠΡΑΞΕΙΣ\` value, items: the first \`ΤΕΜΑΧΙΑ\` value }. Department names vary — extract whatever is printed.
- \`ΑΡ. ΜΗΤΡΩΟΥ:\` → register_serial (e.g. "DSN 23004085")
- Final block \`ΑΝΑΦΟΡΑ ΑΠΟ ΤΟΝ SERVER ΤΗΣ Γ.Γ.Π.Σ.\`: if it shows \`Z= <same z_number>\` and \`OK\` → aade_transmitted true; if visibly failed → false; if the block is missing from the photos → null

IGNORE COMPLETELY:

- \`ΤΕΛΕΥΤΑΙΑ ΣΥΝΟΛΑ ΜΝΗΜΗΣ ΕΦΟΡΙΑΣ\` — these are LIFETIME cumulative fiscal-memory totals (large numbers like 288.300,04). They are never daily figures.
- Technical counters (ΒΛΑΒΗ CMOS, ΕΠΕΜΒΑΣΗ ΤΕΧΝΙΚΟΥ, ΑΠΟΣΥΝΔΕΣΗ …)
- \`ΔΕΛΤΙΟ ΥΠΟΓΡΑΦΗΣ ΗΜΕΡΗΣΙΩΝ ΔΕΔΟΜΕΝΩΝ\` signature hashes
- \`ΑΝΑΦΟΡΑ ΚΑΤΗΓΟΡΙΩΝ\` (redundant with departments) and repeated shop headers

Number format: Greek — decimal comma, thousands dot ("162,75" → 162.75; "69.192,07" → 69192.07). Quantities like \`ΤΕΜΑΧΙΑ 11,000\` mean 11 items. Dates are DD-MM-YYYY.

Return ONLY valid JSON:
{ "business_date": "YYYY-MM-DD"|null, "z_time": "HH:MM"|null, "z_number": int|null, "gross_total": number|null, "receipt_count": int|null, "cash_total": number|null, "card_total": number|null, "discounts_total": number|null, "cancelled_total": number|null, "cancelled_count": int|null, "register_serial": string|null, "aade_transmitted": boolean|null, "vat_lines": [{"vat_label": string, "vat_rate": number, "gross_amount": number|null, "net_amount": number|null, "vat_amount": number|null}], "departments": [{"name": string, "amount": number|null, "items": number|null}], "confidence": {"<field>": "high"|"low"}, "warnings": [string] }
If a value is unreadable or absent, use null and add a warning. Never invent values.`;
