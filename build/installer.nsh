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
!endif

; defaults for the options page (silent installs and updates keep what is there)
!macro customInit
  StrCpy $sgDesktopOn ${BST_CHECKED}
  StrCpy $sgContextOn ${BST_CHECKED}
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

  ${If} $sgHasGitKraken == "1"
    ${NSD_CreateCheckbox} 0 36u 100% 12u "&Import the repositories GitKraken has open, and its matching preferences"
    Pop $sgImport
    ${NSD_SetState} $sgImport $sgImportOn
    ${NSD_CreateLabel} 12u 50u 95% 24u "Read only: GitKraken's files are not changed. Hidden branches and stashes, theme, zoom, diff view and fonts come along."
    Pop $0
  ${EndIf}

  ${NSD_CreateLabel} 0 90u 100% 24u "A Start menu shortcut is always created. To keep SuperGit on the taskbar, right-click it there after it starts and choose Pin to taskbar."
  Pop $0
  nsDialogs::Show
FunctionEnd

Function sgOptionsLeave
  ${NSD_GetState} $sgDesktop $sgDesktopOn
  ${NSD_GetState} $sgContext $sgContextOn
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
  ${endIf}
!macroend
