#define AppName "EMWaver"
#ifndef AppVersion
#define AppVersion "preview"
#endif
#ifndef SourceDir
#define SourceDir "..\..\dist\windows-x64"
#endif
#ifndef OutputDir
#define OutputDir "..\..\dist"

[Setup]
AppId={{C170E9A7-8B42-4E27-84A8-5D54664D6F33}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Continual MI LLC
AppPublisherURL=https://emwaver.ai
AppSupportURL=https://emwaver.ai/emwaver/docs
AppUpdatesURL=https://emwaver.ai/emwaver/install
DefaultDirName={autopf}\EMWaver
DefaultGroupName=EMWaver
DisableProgramGroupPage=yes
LicenseFile=..\..\LICENSE
OutputBaseFilename=EMWaverSetup-windows-x64
OutputDir={#OutputDir}
SetupIconFile=..\EMWaver\Assets\emwaver.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
UninstallDisplayIcon={app}\EMWaver.exe
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\EMWaver"; Filename: "{app}\EMWaver.exe"
Name: "{group}\Uninstall EMWaver"; Filename: "{uninstallexe}"
Name: "{autodesktop}\EMWaver"; Filename: "{app}\EMWaver.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\EMWaver.exe"; Description: "{cm:LaunchProgram,EMWaver}"; Flags: nowait postinstall skipifsilent
