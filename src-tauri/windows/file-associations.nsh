; Register candidates for Windows Settings and Open With. Do not assign defaults.
; Tauri's built-in APP_ASSOCIATE also replaces the extension's default value, so
; use these hooks for Windows instead of bundle.fileAssociations.
!macro KIKKI_REGISTER_DOCUMENT EXT DESCRIPTION
  WriteRegStr SHCTX "Software\Classes\${BUNDLEID}.${EXT}" "" "${DESCRIPTION}"
  WriteRegStr SHCTX "Software\Classes\${BUNDLEID}.${EXT}" "FriendlyTypeName" "${DESCRIPTION}"
  WriteRegStr SHCTX "Software\Classes\${BUNDLEID}.${EXT}" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\${BUNDLEID}.${EXT}\DefaultIcon" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0'
  WriteRegStr SHCTX "Software\Classes\${BUNDLEID}.${EXT}\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${BUNDLEID}.${EXT}" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}" ""
  WriteRegStr SHCTX "Software\${BUNDLEID}\Capabilities\FileAssociations" ".${EXT}" "${BUNDLEID}.${EXT}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro KIKKI_REGISTER_DOCUMENT "pdf" "PDF Document"
  !insertmacro KIKKI_REGISTER_DOCUMENT "kpdf" "Kikki PDF Project"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\DefaultIcon" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0'
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegStr SHCTX "Software\${BUNDLEID}\Capabilities" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\${BUNDLEID}\Capabilities" "ApplicationDescription" "Local PDF editor"
  WriteRegStr SHCTX "Software\${BUNDLEID}\Capabilities" "ApplicationIcon" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0'
  WriteRegStr SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}" "Software\${BUNDLEID}\Capabilities"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
!macroend

!macro KIKKI_UNREGISTER_DOCUMENT EXT
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${BUNDLEID}.${EXT}"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.${EXT}\OpenWithProgids"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.${EXT}"
  DeleteRegKey SHCTX "Software\Classes\${BUNDLEID}.${EXT}"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; An older installation must not remove a newer installation's registration.
  ReadRegStr $R0 SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" ""
  ${If} $R0 == '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
    !insertmacro KIKKI_UNREGISTER_DOCUMENT "pdf"
    !insertmacro KIKKI_UNREGISTER_DOCUMENT "kpdf"
    DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
    DeleteRegKey SHCTX "Software\${BUNDLEID}\Capabilities"
    DeleteRegKey /ifempty SHCTX "Software\${BUNDLEID}"
    DeleteRegValue SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
  ${EndIf}
!macroend
