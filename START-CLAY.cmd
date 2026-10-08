@echo off
cd /d "%~dp0"
echo Open http://127.0.0.1:8920/index.html in your browser.
python serve.py 8920
pause
