; A small executable that runs the production registration hooks with test IDs.
; Compile with makensis -DTEST_OUTFILE=<path> tests/windows/file-associations.nsi.
Unicode true
RequestExecutionLevel user
SilentInstall silent
Name "Kikki PDF association test"
OutFile "${TEST_OUTFILE}"
!include LogicLib.nsh
!include FileFunc.nsh
!define PRODUCTNAME "Kikki PDF association test"
!define BUNDLEID "io.kikki.pdf.association-test"
!define MAINBINARYNAME "kikki-pdf-association-test"
!include "../../src-tauri/windows/file-associations.nsh"
Section
  SetShellVarContext current
  SetRegView 64
  StrCpy $INSTDIR "C:\Kikki PDF test\日本語"
  ClearErrors
  ${GetOptions} $CMDLINE "/REMOVE" $R0
  ${IfNot} ${Errors}
    !insertmacro NSIS_HOOK_POSTUNINSTALL
  ${Else}
    ClearErrors
    ${GetOptions} $CMDLINE "/OLDINSTALL" $R0
    ${IfNot} ${Errors}
      StrCpy $INSTDIR "C:\Kikki PDF old installation"
      !insertmacro NSIS_HOOK_POSTUNINSTALL
    ${Else}
      !insertmacro NSIS_HOOK_POSTINSTALL
    ${EndIf}
  ${EndIf}
SectionEnd
