; NewerTabX Inno Setup script: iscc /DAppVersion=1.2.3 build\installer.iss

#ifndef AppVersion
  #define AppVersion "0.0.0-dev"
#endif

[Setup]
AppName=NewerTabX
AppVersion={#AppVersion}
AppPublisher=NewerTabX
DefaultDirName={localappdata}\Programs\NewerTabX
DefaultGroupName=NewerTabX
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=NewerTabX-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\NewerTabX.exe
CloseApplications=yes
RestartApplications=no

[Files]
Source: "..\dist\NewerTabX\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\NewerTabX"; Filename: "{app}\NewerTabX.exe"
Name: "{autodesktop}\NewerTabX"; Filename: "{app}\NewerTabX.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional tasks:"

[Run]
Filename: "{app}\NewerTabX.exe"; Description: "Launch NewerTabX"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; User data lives in %APPDATA%\NewerTabX and is kept on uninstall
Type: filesandordirs; Name: "{app}"
