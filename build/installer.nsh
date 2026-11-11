; SuperGit installer additions (electron-builder include)

; SuperGit drives the git command line. If Git for Windows is missing, offer its download page
; (the installation of SuperGit itself continues either way; silent installs skip the question).
!macro customInstall
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
