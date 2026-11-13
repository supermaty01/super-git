@echo off
setlocal
rem SuperGit command line: supergit [path | supergit:// link] (supergit --help lists the options)
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\SuperGit.exe" "%~dp0..\app.asar\out\main\cli.js" %*
endlocal
