# Constants for the Userbase Creation SOP pipeline.
# Source of truth: Userbase_Creation_SOP.docx (Draft v1.0).

EMAIL_COLUMN = "Employee Email"
ZONE_VALIDATION_COLUMN = "Zone Validation"
OT_COLUMN = "OT (Yes/No)"
O365_COLUMN = "SSOUPN as per AD (O365)"
SAVIYNT_COLUMN = "SSOUPN as per Saviynt"
AURORA_COLUMN = "Aurora (Yes/No)"
BSC_COLUMN = "BSC (Yes/No)"

ZONES = ["MAZ", "SAZ", "NAZ", "APC", "AFR", "EUR", "GHQ", "Growth"]

# Single-zone run: the Datamart column whose value decides which zone a person
# belongs to. Rows whose value != the chosen zone are dropped up front (Stage 1).
ZONE_FILTER_COLUMN = "Macro Entity Level 2 (Zone)"

# SOP STEP 1 — the 21 Datamart columns to retain.
REQUIRED_COLUMNS = [
    "Zone",
    "Country",
    "Global Employee ID",
    "Local Employee ID",
    "Employee Name",
    "Employee Status",
    "Worker Type",
    "Employee Group",
    "Management Level",
    "First Hire Date",
    "Last Hire Date",
    "Position Name",
    "Job Family Group",
    "Job Family",
    "Job Profile Description",
    "ABI Entity 2",
    "Macro Entity Level 2 (Zone)",
    "Employee Email",
    "Band 4+",
    "Manager Employee ID Level 01",
    "Manager Name Level 01",
]

# SOP STEP 4 — OT filter criteria.
OT_JOB_FAMILY_GROUP = ["SUPPLY"]

OT_JOB_FAMILY = [
    "Engineering & Maintenance",
    "Plant Management",
]

OT_JOB_PROFILES = [
    "Automation Engineer I",
    "Automation Engineer II",
    "Automation Engineer III",
    "Automation Technician I",
    "Automation Technician II",
    "Brewery Plant Director I",
    "Brewery Plant Manager",
    "Electrical I",
    "Electrical II",
    "Engineering & Maintenance Manager I",
    "Engineering & Maintenance Manager II",
    "Engineering & Maintenance Specialist I",
    "Engineering & Maintenance Specialist II",
    "Engineering & Maintenance Specialist III",
    "Engineering & Maintenance Supervisor I",
    "Engineering & Maintenance Supervisor II",
    "Instrumentation Technician I",
    "Instrumentation Technician II",
    "Maintenance Auxiliary I",
    "Maintenance Engineer I",
    "Maintenance Engineer II",
    "Maintenance Engineer III",
    "Maintenance Technician I",
    "Maintenance Technician II",
    "Maintenance Technician III",
    "Maintenance Technician IV",
    "Malting Plant Manager",
    "Mechanical I",
    "Mechanical II",
    "SoftDrinks Plant Manager",
    "Vertical Plant Manager",
]

INPUT_SLOTS = ["datamart", "o365", "saviynt", "aurora", "bsc", "ceo"] + [
    f"zone_{z}" for z in ZONES
]
