; SuperGit installer additions (electron-builder include)

!ifndef BUILD_UNINSTALLER
  !include nsDialogs.nsh
  !include LogicLib.nsh

  Var sgDesktop
  Var sgDesktopOn
  Var sgContext
  Var sgContextOn
  Var sgImport
  Var sgImportOn
  Var sgHasGitKraken
  Var sgPath
  Var sgPathOn
!endif

; "Add supergit to PATH": the user PATH (HKCU\Environment, no admin rights) gets or loses
; $INSTDIR\resources\bin, read and written raw so %VARIABLES% in it stay unexpanded. PowerShell
; does the edit because NSIS strings are cut at 1024 characters, which a long PATH exceeds.
; The folder comes in through the SG_BIN_DIR environment variable, so no quoting is involved.
!define SG_PS '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command'
!define SG_PATH_READ `$$d=$$env:SG_BIN_DIR; $$k=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment'); $$p=[string]$$k.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); $$a=@($$p -split ';' | Where-Object { $$_ -and ($$_.TrimEnd('\') -ne $$d.TrimEnd('\')) });`
!define SG_PATH_ADD `${SG_PATH_READ} $$a+=$$d; $$k.SetValue('Path',($$a -join ';'),[Microsoft.Win32.RegistryValueKind]::ExpandString); $$k.Close()`
!define SG_PATH_REMOVE `${SG_PATH_READ} if ($$a.Count) { $$k.SetValue('Path',($$a -join ';'),[Microsoft.Win32.RegistryValueKind]::ExpandString) } else { $$k.DeleteValue('Path',$$false) }; $$k.Close()`

!macro sgPathEdit SCRIPT
  System::Call 'Kernel32::SetEnvironmentVariable(t "SG_BIN_DIR", t "$INSTDIR\resources\bin") i'
  nsExec::Exec `${SG_PS} "${SCRIPT}"`
  Pop $0
  ; tell Explorer (and terminals started from it) that the environment changed: WM_SETTINGCHANGE
  SendMessage 0xFFFF 0x001A 0 "STR:Environment" /TIMEOUT=5000
!macroend

; defaults for the options page (silent installs and updates keep what is there)
!macro customInit
  StrCpy $sgDesktopOn ${BST_CHECKED}
  StrCpy $sgContextOn ${BST_CHECKED}
  ; on unless it was turned off in an earlier install (silent updates keep that choice)
  StrCpy $sgPathOn ${BST_CHECKED}
  ReadRegStr $0 HKCU "Software\SuperGit" "AddToPath"
  StrCmp $0 "0" 0 +2
    StrCpy $sgPathOn ${BST_UNCHECKED}
  StrCpy $sgHasGitKraken "0"
  IfFileExists "$APPDATA\.gitkraken\profiles\*.*" 0 +2
    StrCpy $sgHasGitKraken "1"
  StrCpy $sgImportOn ${BST_UNCHECKED}
  StrCmp $sgHasGitKraken "1" 0 +2
    StrCpy $sgImportOn ${BST_CHECKED}
!macroend

; "Additional options": shortcuts, Explorer integration, and bringing over what GitKraken has open
; (the page functions live in the macro: it is expanded after the Modern UI is loaded)
!macro customPageAfterChangeDir
  Page custom sgOptionsPage sgOptionsLeave
Function sgOptionsPage
  !insertmacro MUI_HEADER_TEXT "Additional options" "Choose how SuperGit fits into Windows."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateCheckbox} 0 0u 100% 12u "Create a &desktop shortcut"
  Pop $sgDesktop
  ${NSD_SetState} $sgDesktop $sgDesktopOn

  ${NSD_CreateCheckbox} 0 18u 100% 12u 'Add "Open with &SuperGit" to the folder right-click menu in Explorer'
  Pop $sgContext
  ${NSD_SetState} $sgContext $sgContextOn

  ${NSD_CreateCheckbox} 0 36u 100% 12u "Add s&upergit to PATH (open a repository from a terminal with: supergit .)"
  Pop $sgPath
  ${NSD_SetState} $sgPath $sgPathOn

  ${If} $sgHasGitKraken == "1"
    ${NSD_CreateCheckbox} 0 54u 100% 12u "&Import the repositories GitKraken has open, and its matching preferences"
    Pop $sgImport
    ${NSD_SetState} $sgImport $sgImportOn
    ${NSD_CreateLabel} 12u 68u 95% 24u "Read only: GitKraken's files are not changed. Hidden branches and stashes, theme, zoom, diff view and fonts come along."
    Pop $0
  ${EndIf}

  ${NSD_CreateLabel} 0 104u 100% 24u "A Start menu shortcut is always created. To keep SuperGit on the taskbar, right-click it there after it starts and choose Pin to taskbar."
  Pop $0
  nsDialogs::Show
FunctionEnd

Function sgOptionsLeave
  ${NSD_GetState} $sgDesktop $sgDesktopOn
  ${NSD_GetState} $sgContext $sgContextOn
  ${NSD_GetState} $sgPath $sgPathOn
  ${If} $sgHasGitKraken == "1"
    ${NSD_GetState} $sgImport $sgImportOn
  ${EndIf}
FunctionEnd
!macroend



!macro customInstall
  ; options from the page above (interactive installs only)
  IfSilent sgOptionsDone
  ${If} $sgDesktopOn == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\SuperGit.lnk" "$INSTDIR\SuperGit.exe" "" "$INSTDIR\SuperGit.exe" 0
    WinShell::SetLnkAUMI "$DESKTOP\SuperGit.lnk" "${APP_ID}"
  ${Else}
    Delete "$DESKTOP\SuperGit.lnk"
  ${EndIf}
  ${If} $sgContextOn == ${BST_CHECKED}
    WriteRegStr HKCU "Software\Classes\Directory\shell\SuperGit" "" "Open with SuperGit"
    WriteRegStr HKCU "Software\Classes\Directory\shell\SuperGit" "Icon" "$INSTDIR\SuperGit.exe"
    WriteRegStr HKCU "Software\Classes\Directory\shell\SuperGit\command" "" '"$INSTDIR\SuperGit.exe" "%V"'
    WriteRegStr HKCU "Software\Classes\Directory\Background\shell\SuperGit" "" "Open with SuperGit"
    WriteRegStr HKCU "Software\Classes\Directory\Background\shell\SuperGit" "Icon" "$INSTDIR\SuperGit.exe"
    WriteRegStr HKCU "Software\Classes\Directory\Background\shell\SuperGit\command" "" '"$INSTDIR\SuperGit.exe" "%V"'
  ${Else}
    DeleteRegKey HKCU "Software\Classes\Directory\shell\SuperGit"
    DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\SuperGit"
  ${EndIf}
  ${If} $sgImportOn == ${BST_CHECKED}
    ; SuperGit reads this once on its next start
    CreateDirectory "$APPDATA\SuperGit"
    FileOpen $0 "$APPDATA\SuperGit\import-gitkraken.flag" w
    FileWrite $0 "1"
    FileClose $0
  ${EndIf}
  sgOptionsDone:

  ; the supergit command (resourcesin\supergit.cmd, and supergit for Git Bash) on the user PATH.
  ; Silent installs (automatic updates) apply the remembered choice, on by default.
  ${If} $sgPathOn == ${BST_CHECKED}
    !insertmacro sgPathEdit `${SG_PATH_ADD}`
    WriteRegStr HKCU "Software\SuperGit" "AddToPath" "1"
  ${Else}
    !insertmacro sgPathEdit `${SG_PATH_REMOVE}`
    WriteRegStr HKCU "Software\SuperGit" "AddToPath" "0"
  ${EndIf}

  ; supergit:// links (supergit://repo/<path>, supergit://repolink/...) open SuperGit
  WriteRegStr HKCU "Software\Classes\supergit" "" "URL:SuperGit"
  WriteRegStr HKCU "Software\Classes\supergit" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\supergit\DefaultIcon" "" "$INSTDIR\SuperGit.exe,0"
  WriteRegStr HKCU "Software\Classes\supergit\shell\open\command" "" '"$INSTDIR\SuperGit.exe" "%1"'

  ; SuperGit drives the git command line. If Git for Windows is missing, offer its download page
  ; (the installation of SuperGit itself continues either way; silent installs skip the question).
  IfSilent sgGitDone
  SetRegView 64
  ReadRegStr $0 HKLM "SOFTWARE\GitForWindows" "InstallPath"
  StrCmp $0 "" 0 sgGitFound
  ReadRegStr $0 HKCU "SOFTWARE\GitForWindows" "InstallPath"
  StrCmp $0 "" 0 sgGitFound
  nsExec::ExecToStack 'cmd /c where git'
  Pop $1
  Pop $2
  StrCmp $1 "0" sgGitFound
  MessageBox MB_YESNO|MB_ICONINFORMATION "SuperGit works on top of Git for Windows, which was not found on this computer.$\r$\n$\r$\nOpen the Git for Windows download page now? SuperGit finishes installing either way; install Git before opening a repository." IDNO sgGitFound
  ExecShell "open" "https://git-scm.com/download/win"
  sgGitFound:
  SetRegView lastused
  sgGitDone:
!macroend

; an update runs the old uninstaller first: keep the shortcut and the Explorer entry then
!macro customUnInstall
  ${ifNot} ${isUpdated}
    Delete "$DESKTOP\SuperGit.lnk"
    DeleteRegKey HKCU "Software\Classes\Directory\shell\SuperGit"
    DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\SuperGit"
    DeleteRegKey HKCU "Software\Classes\supergit"
    !insertmacro sgPathEdit `${SG_PATH_REMOVE}`
    DeleteRegValue HKCU "Software\SuperGit" "AddToPath"
    DeleteRegKey /ifempty HKCU "Software\SuperGit"
  ${endIf}
!macroend
