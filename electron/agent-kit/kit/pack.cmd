@echo off
rem Pack an HTML file into one offline file. Usage: pack.cmd lesson.html
setlocal
set ELECTRON_RUN_AS_NODE=1
if defined CS_NODE (
  "%CS_NODE%" "%~dp0pack.cjs" %*
) else (
  node "%~dp0pack.cjs" %*
)
