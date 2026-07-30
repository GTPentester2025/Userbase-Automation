@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo First run: creating Python environment...
    py -3 -m venv .venv || python -m venv .venv
    ".venv\Scripts\pip" install -r requirements.txt
)
".venv\Scripts\python" -c "import fastapi, pandas, pyarrow, xlsxwriter, openpyxl" 2>nul || ".venv\Scripts\pip" install -r requirements.txt
start "" "http://127.0.0.1:8765/"
".venv\Scripts\python" server.py
