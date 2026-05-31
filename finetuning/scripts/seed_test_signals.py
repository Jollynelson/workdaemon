"""
Seed two fake companies with realistic training signals for pipeline testing.

Writes the canonical Company Brain schema (spec §5):
  companies + training_signals + cb_company_terminology.

Q&A pairs become `positive_pair` training_signals; critiques become
`critique_correction` signals; terminology lands in cb_company_terminology.
Signals are inserted with interaction_id = NULL, so the eval holdout keys on
each signal's own (random) UUID — giving a natural ~10% eval split.

Usage:
    python scripts/seed_test_signals.py            # insert signals
    python scripts/seed_test_signals.py --reset    # delete existing test data first

The two companies use fixed UUIDs so the script is safe to run multiple times
(signals accumulate; companies are upserted).
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

# Allow running as `python scripts/seed_test_signals.py` from repo root.
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.db import db

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger(__name__)

# ── Fixed test company IDs ─────────────────────────────────────────────────────

COMPANY_A_ID = "aaaaaaaa-0000-0000-0000-000000000001"
COMPANY_B_ID = "bbbbbbbb-0000-0000-0000-000000000001"

COMPANIES = [
    {"id": COMPANY_A_ID, "name": "Acme Ventures", "slug": "acme-ventures"},
    {"id": COMPANY_B_ID, "name": "Nexus Health", "slug": "nexus-health"},
]

# ── Seed data ──────────────────────────────────────────────────────────────────

ACME_QA: list[tuple[str, str]] = [
    ("What is our target AUM for this fund?", "Fund III targets $150M AUM, with a hard cap of $175M. We are currently at $112M committed."),
    ("Who is the lead partner on the Stripe deal?", "Sarah Chen is the lead partner. Marcus Liu is the supporting analyst covering fintech."),
    ("What is our standard SAFE note valuation cap?", "Our standard pre-seed SAFE cap is $8M. For repeat founders we go up to $12M at our discretion."),
    ("When does Fund II close?", "Fund II reached its final close in March 2024. All capital is deployed or reserved."),
    ("What is our portfolio company Helios doing?", "Helios builds AI-powered solar forecasting for utility operators. Series A, $14M raised, growing 3x YoY."),
    ("What is our management fee structure?", "2% management fee during the investment period, stepping down to 1.5% during harvest. Standard carry is 20%."),
    ("Which LPs are in Fund III?", "Fund III LPs include Stanford Endowment, Sequoia Heritage, and several family offices. NDA prevents full disclosure."),
    ("What is the typical check size for seed investments?", "Seed checks are $500K–$1.5M for 8–15% ownership. We reserve 1x for follow-ons."),
    ("How do we handle pro-rata rights?", "We negotiate pro-rata rights on all deals above $1M. We exercise selectively based on performance signals."),
    ("What are our thesis areas for Fund III?", "Climate tech, AI infrastructure, and healthcare data. We avoid consumer apps and crypto."),
    ("What is Project Atlas?", "Project Atlas is our internal name for the potential acquisition of DataPulse Inc. Under NDA and active diligence."),
    ("What is our IRR on Fund I?", "Fund I net IRR is 34% as of Q1 2024. Top performers: Helios (12x), Vertex AI (8x)."),
    ("Who handles LP relations?", "Mei Rodriguez is our Head of Investor Relations. She sends quarterly updates every mid-month."),
    ("What is our co-investment policy?", "LPs with $5M+ commitments get co-investment rights on deals above $3M. 10-day decision window."),
    ("What is the current valuation of our Nexus Health stake?", "Nexus Health is a portfolio company of Fund II. Current marked value is $4.2M on a $600K cost basis."),
    ("How long is our investment horizon?", "10-year fund life with two 1-year extensions. Typical hold is 5–7 years to exit."),
    ("What ESG criteria do we apply?", "We screen for carbon footprint, board diversity, and data privacy practices. Helios and Luminary pass all three."),
    ("Who is our legal counsel?", "Cooley LLP for fund formation and M&A. Wilson Sonsini for portfolio company matters."),
    ("What is our carried interest vesting schedule?", "Carry vests over 4 years with a 1-year cliff, tied to continued employment."),
    ("What is the status of the DataPulse diligence?", "Phase 2 diligence underway. Technical review complete. Financial audit with Deloitte in progress. Decision expected Q3 2024."),
    ("How do we value early-stage positions?", "We mark at cost until a priced round. After a priced round, we mark to the latest round price, discounted for illiquidity."),
    ("What is our fund admin's name?", "Carta handles fund administration. Our dedicated CSM is Jordan Park."),
    ("What sectors do we avoid?", "We avoid consumer social, crypto/web3, and defense tech. We also avoid companies with active regulatory investigations."),
    ("What is the carry split among partners?", "Managing partners split 70% of carry equally. 20% is reserved for the associate pool. 10% is discretionary."),
    ("Who do I contact for wiring instructions?", "Contact ops@acmeventures.com. All wires must be confirmed via a secondary phone call per our security policy."),
    ("What is our typical board seat policy?", "We take one board seat for checks above $1M. Observer rights for smaller checks."),
    ("What is our recycling policy?", "We recycle management fees and early exits up to 15% of committed capital during the investment period."),
    ("What reporting do we require from portfolio companies?", "Monthly KPI dashboards via Visible. Quarterly board packs. Annual audited financials."),
    ("Who is the CFO of Helios?", "David Okonkwo joined as CFO in January 2024. He was previously VP Finance at Palantir."),
    ("What is Luminary's current ARR?", "Luminary's ARR is $3.2M as of Q1 2024, up from $1.1M a year ago."),
    ("What is our side letter policy?", "MFN side letters are granted to LPs with $10M+ commitments. We do not grant key-person carve-outs."),
    ("What is the Fund III close date?", "Target final close is September 2024. First close was February 2024 at $62M."),
    ("How do we handle conflicts of interest?", "All conflicts are disclosed to the LP Advisory Committee within 5 business days. The LPAC votes on material conflicts."),
    ("What is our preferred ownership target at exit?", "We target 10–20% ownership at exit after dilution. Below 5% we consider secondary sales."),
    ("What is the current NAV of Fund II?", "Fund II NAV is $87M as of Q1 2024 against $60M invested. TVPI is 1.9x."),
    ("Who approves new investments?", "Investment Committee consists of the three Managing Partners. Majority vote required. Deals above $2M require unanimity."),
    ("What is our standard NDA template?", "We use a mutual NDA with a 2-year tail. Available in the shared drive under Legal > Templates."),
    ("What is the GP commitment for Fund III?", "GP commits 2% of fund size ($3M) drawn pro-rata alongside LP capital calls."),
    ("How do we handle portfolio company bankruptcies?", "We write down immediately upon insolvency filing. Legal team manages claims. We do not participate in DIP financing."),
    ("What is our wire transfer fraud prevention policy?", "All outbound wires above $50K require dual approval from two Managing Partners and a live verbal confirmation."),
]

NEXUS_QA: list[tuple[str, str]] = [
    ("What is our core product?", "Nexus Health builds an AI-powered clinical decision support platform for emergency departments. Our flagship product is NexusED."),
    ("What is our monthly burn rate?", "Current monthly burn is $380K. Runway is 14 months at current burn. Series B fundraise begins Q3 2024."),
    ("Who is our largest customer?", "Mercy General Health System, a 12-hospital network in the Midwest. $420K ARR. Renews in October."),
    ("What is our HIPAA compliance status?", "Fully HIPAA-compliant. BAAs in place with all customers. Annual penetration test completed March 2024. SOC 2 Type II in progress."),
    ("What is NexusED's core differentiator?", "NexusED reduces ED length-of-stay by 22% on average by triaging patients before physician contact using our proprietary risk model."),
    ("What is our current ARR?", "ARR is $2.1M as of Q2 2024, up 140% YoY. NRR is 118%."),
    ("Who is our CTO?", "Dr. Priya Sharma, MD PhD. Former faculty at Stanford Medical. She leads a team of 8 engineers and 2 clinical informaticists."),
    ("What EHR systems do we integrate with?", "Epic and Cerner via HL7 FHIR APIs. Meditech integration is in beta. Athenahealth is on the roadmap for Q4."),
    ("What is our FDA regulatory status?", "NexusED is classified as a Class II medical device. 510(k) clearance obtained January 2023. De Novo pathway for NexusICU."),
    ("What is the status of the Ascension Health deal?", "Ascension is in final contract negotiations. Legal reviewing BAA and data processing addendum. Expected close Q3 2024 at $280K ARR."),
    ("What is our Series B target?", "We are targeting $18M Series B at a $65M pre-money valuation. Lead investor conversations underway with a16z and General Catalyst."),
    ("What is our churn rate?", "Zero logo churn since launch. One customer reduced seats by 15% during a budget freeze, recovered next quarter."),
    ("Who is our Head of Sales?", "James Thornton joined in February 2024. Previously VP Sales at Particle Health. He owns the $3M ARR target for 2024."),
    ("What data does NexusED use for predictions?", "Vital signs, chief complaint, triage notes, and historical visit data from the EHR. We never train on data across customer boundaries."),
    ("What is our standard enterprise contract length?", "3-year initial term with annual true-up based on ED visit volume. Average ACV is $210K."),
    ("How does NexusED handle model drift?", "Automated drift detection checks daily. If accuracy drops below 85%, the model flags for clinical review and falls back to rule-based triage."),
    ("What is our gross margin?", "Gross margin is 74% on SaaS revenue. Infrastructure costs are the primary variable. Target is 80% at $5M ARR."),
    ("Who handles regulatory affairs?", "Dr. Linda Castro, our VP of Regulatory. She managed the 510(k) submission and maintains our FDA device listing."),
    ("What is the NexusICU product?", "NexusICU is our next product — predictive deterioration alerts for ICU patients. In clinical validation at Mercy General. Expected launch Q1 2025."),
    ("What is our data retention policy?", "Patient data is retained for the duration of the BAA plus 6 years, per HIPAA requirements. Customers can request deletion on contract termination."),
    ("What is our uptime SLA?", "99.9% uptime guaranteed. Actual uptime is 99.97% over the last 12 months. Downtime triggers service credits."),
    ("How do we handle PHI?", "All PHI is encrypted at rest (AES-256) and in transit (TLS 1.3). We use de-identified data for model training. PHI never leaves the customer's data region."),
    ("What is our pricing model?", "Per-ED per-year subscription based on annual ED visit volume. Tiers: under 30K visits ($120K), 30K–80K ($210K), above 80K ($340K)."),
    ("Who is our largest competitor?", "Qventus is the most commonly mentioned competitor. We win on ED-specific depth and FDA clearance. Losing to them is rare — happened twice in 18 months."),
    ("What is the status of our SOC 2 audit?", "Type II audit underway with A-LIGN. Observation period ends July 2024. Report expected September 2024."),
    ("What is our employee count?", "24 full-time employees. 8 engineering, 4 clinical, 4 sales and customer success, 3 regulatory, 3 finance/ops, 2 executives."),
    ("What is our cap table situation?", "Founders own 42% combined. Series A investors own 35%. ESOP pool is 15%. Angels and advisors hold 8%."),
    ("How does NexusED get deployed?", "Cloud-hosted on AWS us-east-1. Deployed as an iframe embedded in the EHR workflow. No on-premise option currently."),
    ("What are our OKRs for Q3 2024?", "O1: Close Series B. O2: Sign 3 new health systems. O3: Launch NexusICU beta. O4: Achieve SOC 2 Type II."),
    ("Who is our board?", "Board has 5 members: 2 founders, 1 Acme Ventures rep (Sarah Chen), 1 UCSF Health Innovations rep, 1 independent (Dr. Rajiv Mehta)."),
    ("What is our patient data anonymization process?", "We use k-anonymity (k=5) and suppress rare combinations before any analytics. Certified by our DPO quarterly."),
    ("What is our LTV:CAC ratio?", "LTV is $630K based on 3-year ACV and NRR. CAC is $42K blended. LTV:CAC is 15:1."),
    ("What cloud regions do we operate in?", "AWS us-east-1 (primary) and us-west-2 (disaster recovery). EU region planned for 2025 pending GDPR framework."),
    ("How do we onboard new customers?", "90-day implementation: EHR integration (30 days), staff training (30 days), shadow mode validation (30 days). Go-live after clinical sign-off."),
    ("What is our Series A post-money valuation?", "Series A closed at $22M post-money. $5M raised. Lead investor: Acme Ventures. Closed October 2022."),
    ("What is our revenue recognition policy?", "Ratable over contract term. Implementation fees recognized over the 90-day onboarding period. We follow ASC 606."),
    ("What does the clinical validation at Mercy General show?", "12-week validation: NexusED reduced median door-to-doctor time by 19 minutes and improved ESI accuracy by 31% compared to nurse-only triage."),
    ("What is our disaster recovery RTO?", "RTO is 4 hours. RPO is 1 hour. Tested quarterly via tabletop exercises. Last DR test: April 2024, passed."),
    ("What is our ESOP vesting schedule?", "4-year vest, 1-year cliff, monthly thereafter. Options priced at FMV per 409A. Last 409A: $1.80/share, March 2024."),
    ("What is James Thornton's quota?", "James owns the full $3M new ARR target for 2024. Q1 actual: $420K. Q2 actual: $510K. On track."),
]

ACME_TERMINOLOGY = [
    ("Fund III", "Acme Ventures' current active fund. $150M target AUM, first close February 2024."),
    ("Project Atlas", "Internal codename for the potential acquisition of DataPulse Inc. Active diligence under NDA."),
    ("LPAC", "LP Advisory Committee. Votes on conflict-of-interest matters for Fund III."),
    ("TVPI", "Total Value to Paid-In capital. Current Fund II TVPI is 1.9x."),
    ("Helios", "Portfolio company building AI solar forecasting. Series A, top performer at 12x."),
    ("Luminary", "Portfolio company in Fund II. ARR $3.2M, growing 3x YoY."),
    ("Carry", "Carried interest. 20% standard. Split 70/20/10 among partners, associate pool, discretionary."),
    ("DIP financing", "Debtor-in-possession financing. Acme does not participate in DIP for distressed portfolio companies."),
    ("Pro-rata rights", "Right to participate in future rounds proportionally. Negotiated on all deals above $1M."),
    ("MFN side letter", "Most-Favoured-Nation side letter granted to LPs with $10M+ commitments."),
    ("Recycling", "Reinvesting management fees and early exits. Acme recycles up to 15% of committed capital."),
    ("IRR", "Internal Rate of Return. Fund I net IRR is 34% as of Q1 2024."),
    ("DataPulse", "Target company under acquisition diligence. See Project Atlas."),
    ("Visible", "Portfolio reporting tool. All portfolio companies submit monthly KPI dashboards here."),
    ("Investment Committee", "Three Managing Partners. Majority vote for most deals; unanimity for deals above $2M."),
]

NEXUS_TERMINOLOGY = [
    ("NexusED", "Acme's flagship AI clinical decision support product for emergency departments."),
    ("NexusICU", "Next product in development. Predictive deterioration alerts for ICU patients. Launching Q1 2025."),
    ("510(k)", "FDA premarket notification. NexusED cleared January 2023. Class II device."),
    ("De Novo pathway", "FDA regulatory route for novel Class II devices with no predicate. Used for NexusICU."),
    ("FHIR", "Fast Healthcare Interoperability Resources. API standard used to integrate with Epic and Cerner EHRs."),
    ("BAA", "Business Associate Agreement. Required under HIPAA for all health system customers."),
    ("ESI", "Emergency Severity Index. 5-level triage scale. NexusED improves ESI accuracy by 31%."),
    ("Mercy General", "Largest customer. 12-hospital Midwest health system. $420K ARR. Renews October 2024."),
    ("Ascension", "Prospect in final contract negotiations. Expected $280K ARR close Q3 2024."),
    ("SOC 2 Type II", "Security compliance audit in progress with A-LIGN. Report expected September 2024."),
    ("PHI", "Protected Health Information. Encrypted at rest and in transit. Never used for cross-customer training."),
    ("NRR", "Net Revenue Retention. Currently 118%, indicating strong expansion within existing accounts."),
    ("k-anonymity", "Patient data anonymization standard. Nexus uses k=5, certified quarterly by DPO."),
    ("Door-to-doctor time", "Key ED metric. NexusED reduces median door-to-doctor time by 19 minutes at Mercy General."),
    ("ACV", "Annual Contract Value. Average enterprise ACV is $210K."),
]

# Realistic self-critiques: original bad answer + improved answer
ACME_CRITIQUES: list[tuple[str, str, str]] = [
    (
        "What is our carry structure?",
        "We have standard 20% carry.",
        "Carry is 20% standard. The split is 70% to Managing Partners equally, 20% to the associate pool, and 10% discretionary. Carry vests over 4 years with a 1-year cliff tied to continued employment.",
    ),
    (
        "What is the status of Project Atlas?",
        "It is under diligence.",
        "Project Atlas (potential acquisition of DataPulse Inc.) is in Phase 2 diligence. Technical review is complete. Deloitte is conducting the financial audit. IC decision expected Q3 2024. All details remain under NDA.",
    ),
    (
        "What is our co-investment policy for LPs?",
        "Some LPs can co-invest.",
        "LPs with $5M or more in commitments receive co-investment rights on any deal above $3M. They have a 10-day window to decide. Co-investments are on the same terms as the fund's investment.",
    ),
    (
        "How do we handle a portfolio company going bankrupt?",
        "We write it down.",
        "Upon insolvency filing we immediately write the position down to zero. Our legal team manages any creditor claims. We do not participate in DIP financing for distressed portfolio companies.",
    ),
    (
        "What reporting do portfolio companies send us?",
        "They send quarterly reports.",
        "Portfolio companies submit monthly KPI dashboards via Visible, quarterly board packs ahead of board meetings, and annual audited financials. Failure to report is a governance flag.",
    ),
]

NEXUS_CRITIQUES: list[tuple[str, str, str]] = [
    (
        "What is our uptime guarantee?",
        "We have good uptime.",
        "Our SLA guarantees 99.9% uptime. Actual uptime over the last 12 months has been 99.97%. Any downtime below the SLA threshold triggers service credits per the customer contract.",
    ),
    (
        "How does NexusED handle model drift?",
        "We monitor the model.",
        "Automated drift detection runs daily. If accuracy drops below 85%, the model flags for clinical review and automatically falls back to rule-based triage until the issue is resolved. Customers are notified within 1 hour.",
    ),
    (
        "What is our HIPAA compliance situation?",
        "We are HIPAA compliant.",
        "NexusED is fully HIPAA-compliant. BAAs are in place with all customers. We completed our annual penetration test in March 2024 with no critical findings. SOC 2 Type II audit is in progress with A-LIGN, report expected September 2024.",
    ),
    (
        "What is our patient data anonymization approach?",
        "We anonymize patient data.",
        "We apply k-anonymity with k=5, suppressing rare attribute combinations. This process is certified quarterly by our Data Protection Officer. PHI is never used for cross-customer model training.",
    ),
    (
        "What is our onboarding process for new customers?",
        "We have a 90-day onboarding.",
        "Onboarding is a structured 90-day process: EHR integration in the first 30 days, staff training in days 31–60, and shadow mode clinical validation in days 61–90. Go-live only occurs after formal clinical sign-off.",
    ),
]


# ── Helpers ────────────────────────────────────────────────────────────────────


def upsert_companies() -> None:
    for company in COMPANIES:
        db().table("companies").upsert(company, on_conflict="id").execute()
    log.info("Upserted %d companies.", len(COMPANIES))


def seed_company(
    company_id: str,
    company_name: str,
    qa_pairs: list[tuple[str, str]],
    terminology: list[tuple[str, str]],
    critiques: list[tuple[str, str, str]],
) -> None:
    log.info("Seeding %s (%s)...", company_name, company_id)

    # ── positive_pair training_signals (from Q&A) ──────────────────────────────
    positive_rows = []
    for i, (query, answer) in enumerate(qa_pairs):
        # Vary the score a little for realistic dedup behavior
        score = [0.91, 0.84, 0.78][i % 3]
        positive_rows.append({
            "company_id": company_id,
            "interaction_id": None,
            "kind": "positive_pair",
            "prompt": query,
            "target": answer,
            "score": score,
        })
    db().table("training_signals").insert(positive_rows).execute()
    log.info("  Inserted %d positive_pair signals.", len(positive_rows))

    # ── critique_correction training_signals (target = improved answer) ─────────
    critique_rows = [
        {
            "company_id": company_id,
            "interaction_id": None,
            "kind": "critique_correction",
            "prompt": query,
            "target": improved_answer,
            "score": 0.82,
        }
        for query, _bad_answer, improved_answer in critiques
    ]
    db().table("training_signals").insert(critique_rows).execute()
    log.info("  Inserted %d critique_correction signals.", len(critique_rows))

    # ── cb_company_terminology ─────────────────────────────────────────────────
    term_rows = [
        {"company_id": company_id, "term": term, "definition": definition, "source": "seed_script"}
        for term, definition in terminology
    ]
    db().table("cb_company_terminology").insert(term_rows).execute()
    log.info("  Inserted %d terminology entries.", len(term_rows))

    total = len(positive_rows) + len(critique_rows) + len(term_rows)
    log.info("  Total signals for %s: %d", company_name, total)


def reset_test_data() -> None:
    log.info("Resetting test data for both companies...")
    for company_id in [COMPANY_A_ID, COMPANY_B_ID]:
        db().table("training_signals").delete().eq("company_id", company_id).execute()
        db().table("cb_company_terminology").delete().eq("company_id", company_id).execute()
        db().table("model_versions").delete().eq("company_id", company_id).execute()
        db().table("companies").delete().eq("id", company_id).execute()
    log.info("Reset complete.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed test signals for the fine-tuning pipeline.")
    parser.add_argument("--reset", action="store_true", help="Delete existing test data before seeding.")
    args = parser.parse_args()

    if args.reset:
        reset_test_data()

    upsert_companies()

    seed_company(COMPANY_A_ID, "Acme Ventures", ACME_QA, ACME_TERMINOLOGY, ACME_CRITIQUES)
    seed_company(COMPANY_B_ID, "Nexus Health", NEXUS_QA, NEXUS_TERMINOLOGY, NEXUS_CRITIQUES)

    log.info("\nDone. Both companies now have training_signals in the database.")
    log.info("Run the builder to verify:")
    log.info(
        "  python -c \"from src.dataset.builder import build_from_signals; "
        "print(build_from_signals('%s', 'Acme Ventures'))\"",
        COMPANY_A_ID,
    )


if __name__ == "__main__":
    main()
