; Windows runtime replacement. The active payload path stays stable for PM's
; install key, while a previous payload waits for cleanup after a healthy launch.
!macro HERMESS_INSTALL_RUNTIME
  StrCpy $9 ""
  StrCpy $R9 0
  ; Only an installer-written completion marker can bypass extraction.
  ClearErrors
  FileOpen $R0 "$INSTDIR\runtime\payload\.hermess-runtime-sha256" r
  IfErrors hermess_prepare_stage
  FileRead $R0 $R1
  FileClose $R0
  IfErrors hermess_prepare_stage
  StrCmp $R1 "${HERMESS_RUNTIME_SHA256}" 0 hermess_prepare_stage
  IfFileExists "$INSTDIR\runtime\payload\manifest.json" 0 hermess_prepare_stage
  IfFileExists "$INSTDIR\runtime\payload\bin\hermes.exe" 0 hermess_prepare_stage
  Goto hermess_retire_unused_stage

  hermess_prepare_stage:
  ; A failed switch can leave a complete stage. Reuse it on the next attempt.
  ClearErrors
  FileOpen $R0 "$INSTDIR\runtime\payload.next\.hermess-runtime-sha256" r
  IfErrors hermess_clear_stage
  FileRead $R0 $R1
  FileClose $R0
  IfErrors hermess_clear_stage
  StrCmp $R1 "${HERMESS_RUNTIME_SHA256}" 0 hermess_clear_stage
  IfFileExists "$INSTDIR\runtime\payload.next\manifest.json" 0 hermess_clear_stage
  IfFileExists "$INSTDIR\runtime\payload.next\bin\hermes.exe" 0 hermess_clear_stage
  IfFileExists "$INSTDIR\runtime\payload.next\hermes-agent\*.*" 0 hermess_clear_stage
  DetailPrint "Reusing the runtime extracted by the previous installation attempt."
  Goto hermess_stage_ready

  hermess_clear_stage:
  ; A failed extraction may leave a partial staging directory.
  SetDetailsPrint textonly
  RMDir /r "$INSTDIR\runtime\payload.next"
  SetDetailsPrint both
  IfFileExists "$INSTDIR\runtime\payload.next" 0 hermess_stage
    Abort "Unable to clear an incomplete runtime staging directory."

  hermess_stage:
  CreateDirectory "$INSTDIR\runtime\payload.next"
  nsExec::ExecToStack '"$SYSDIR\tar.exe" -xf "$INSTDIR\runtime\payload.tar" -C "$INSTDIR\runtime\payload.next"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    DetailPrint "Unable to extract the bundled runtime: $1"
    Abort "Unable to extract the bundled runtime in the installation directory."
  ${EndIf}
  IfFileExists "$INSTDIR\runtime\payload.next\manifest.json" 0 hermess_invalid_stage
  IfFileExists "$INSTDIR\runtime\payload.next\bin\hermes.exe" 0 hermess_invalid_stage
  IfFileExists "$INSTDIR\runtime\payload.next\hermes-agent\*.*" 0 hermess_invalid_stage
  ClearErrors
  FileOpen $R0 "$INSTDIR\runtime\payload.next\.hermess-runtime-sha256" w
  IfErrors hermess_invalid_stage
  FileWrite $R0 "${HERMESS_RUNTIME_SHA256}"
  FileClose $R0
  Goto hermess_stage_ready

  hermess_invalid_stage:
    Abort "The bundled runtime is incomplete. The previous runtime was kept."

  hermess_stage_ready:
  StrCpy $9 ""
  IfFileExists "$INSTDIR\runtime\payload" 0 hermess_activate_runtime
  IfFileExists "$INSTDIR\runtime\payload\manifest.json" 0 hermess_invalid_old
  ${GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
  StrCpy $7 "$2$1$0$4$5$6"
  StrCpy $8 0
  hermess_unique_name:
    StrCpy $9 "$INSTDIR\runtime\payload.old-$7-$8"
    IfFileExists "$9" hermess_retry_name 0
    IfFileExists "$9.owner" hermess_retry_name hermess_name_ready
  hermess_retry_name:
    IntOp $8 $8 + 1
    Goto hermess_unique_name
  hermess_name_ready:
  ClearErrors
  FileOpen $R0 "$9.owner" w
  IfErrors hermess_marker_failed
  FileWrite $R0 "hermess-agent-desktop-retired-runtime-v1"
  FileClose $R0
  IfErrors hermess_marker_failed
  StrCpy $R8 0
  hermess_try_retire:
  ClearErrors
  Rename "$INSTDIR\runtime\payload" "$9"
  IfErrors hermess_retry_retire
  Goto hermess_activate_runtime

  hermess_retry_retire:
    IntOp $R8 $R8 + 1
    IntCmp $R8 5 hermess_retire_busy hermess_wait_retire hermess_retire_busy
  hermess_wait_retire:
    Sleep 1000
    Goto hermess_try_retire
  hermess_retire_busy:
    IfSilent hermess_retire_failed
    MessageBox MB_ICONEXCLAMATION|MB_RETRYCANCEL "The previous runtime is in use. Close Hermess Agent Desktop and any process using its runtime, then click Retry. The previous runtime is still intact." IDRETRY hermess_try_retire
    Goto hermess_retire_failed

  hermess_invalid_old:
    Abort "The previous runtime is incomplete; refusing to replace it."
  hermess_marker_failed:
    Delete "$9.owner"
    Abort "Unable to mark the previous runtime for safe cleanup."
  hermess_retire_failed:
    Delete "$9.owner"
    Abort "Unable to rename the previous runtime. Close processes using it and run setup again; the previous runtime is intact."

  hermess_activate_runtime:
  ClearErrors
  Rename "$INSTDIR\runtime\payload.next" "$INSTDIR\runtime\payload"
  IfErrors hermess_restore_runtime
  StrCpy $R9 1
  Goto hermess_runtime_ready

  hermess_retire_unused_stage:
  ; A retry of the same archive may leave a complete, unused staging copy.
  ClearErrors
  FileOpen $R0 "$INSTDIR\runtime\payload.next\.hermess-runtime-sha256" r
  IfErrors hermess_runtime_ready
  FileRead $R0 $R1
  FileClose $R0
  IfErrors hermess_runtime_ready
  StrCmp $R1 "${HERMESS_RUNTIME_SHA256}" 0 hermess_runtime_ready
  IfFileExists "$INSTDIR\runtime\payload.next\manifest.json" 0 hermess_runtime_ready
  IfFileExists "$INSTDIR\runtime\payload.next\bin\hermes.exe" 0 hermess_runtime_ready
  IfFileExists "$INSTDIR\runtime\payload.next\hermes-agent\*.*" 0 hermess_runtime_ready
  ${GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
  StrCpy $7 "$2$1$0$4$5$6"
  StrCpy $8 0
  hermess_unused_stage_name:
    StrCpy $9 "$INSTDIR\runtime\payload.old-$7-$8"
    IfFileExists "$9" hermess_unused_stage_retry_name 0
    IfFileExists "$9.owner" hermess_unused_stage_retry_name hermess_unused_stage_mark
  hermess_unused_stage_retry_name:
    IntOp $8 $8 + 1
    Goto hermess_unused_stage_name
  hermess_unused_stage_mark:
    ClearErrors
    FileOpen $R0 "$9.owner" w
    IfErrors hermess_runtime_ready
    FileWrite $R0 "hermess-agent-desktop-retired-runtime-v1"
    FileClose $R0
    IfErrors hermess_unused_stage_mark_failed
    ClearErrors
    Rename "$INSTDIR\runtime\payload.next" "$9"
    IfErrors hermess_unused_stage_mark_failed
    DetailPrint "Retired the unused runtime staging copy for background cleanup."
    Goto hermess_runtime_ready
  hermess_unused_stage_mark_failed:
    Delete "$9.owner"

  hermess_runtime_ready:
  ; The old executable is kept until the new gateway has started successfully.
  Delete "$INSTDIR\${MAINBINARYNAME}.old.exe"
  IfFileExists "$INSTDIR\${MAINBINARYNAME}.old.exe" 0 hermess_replace_executable
    Goto hermess_restore_runtime
  hermess_replace_executable:
  IfFileExists "$INSTDIR\${MAINBINARYNAME}.exe" 0 hermess_activate_executable
  ClearErrors
  Rename "$INSTDIR\${MAINBINARYNAME}.exe" "$INSTDIR\${MAINBINARYNAME}.old.exe"
  IfErrors hermess_restore_runtime
  hermess_activate_executable:
  ClearErrors
  Rename "$INSTDIR\${MAINBINARYNAME}.next.exe" "$INSTDIR\${MAINBINARYNAME}.exe"
  IfErrors hermess_restore_executable
  Goto hermess_runtime_done

  hermess_restore_executable:
    Rename "$INSTDIR\${MAINBINARYNAME}.old.exe" "$INSTDIR\${MAINBINARYNAME}.exe"
  hermess_restore_runtime:
    ${If} $R9 = 1
      Rename "$INSTDIR\runtime\payload" "$INSTDIR\runtime\payload.next"
      ${If} $9 != ""
        Rename "$9" "$INSTDIR\runtime\payload"
        Delete "$9.owner"
      ${EndIf}
    ${EndIf}
    Abort "Unable to activate the new runtime; the previous runtime was restored."

  hermess_runtime_done:
!macroend

!macro HERMESS_UNINSTALL_RUNTIME
  SetDetailsPrint textonly
  RMDir /r "$INSTDIR\runtime\payload"
  RMDir /r "$INSTDIR\runtime\payload.next"
  FindFirst $R0 $R1 "$INSTDIR\runtime\payload.old-*"
  hermess_uninstall_old_loop:
    StrCmp $R1 "" hermess_uninstall_old_done
    ClearErrors
    FileOpen $R2 "$INSTDIR\runtime\$R1.owner" r
    IfErrors hermess_uninstall_old_next
    FileRead $R2 $R3
    FileClose $R2
    StrCmp $R3 "hermess-agent-desktop-retired-runtime-v1" 0 hermess_uninstall_old_next
    RMDir /r "$INSTDIR\runtime\$R1"
    IfFileExists "$INSTDIR\runtime\$R1" hermess_uninstall_old_next 0
    Delete "$INSTDIR\runtime\$R1.owner"
  hermess_uninstall_old_next:
    FindNext $R0 $R1
    Goto hermess_uninstall_old_loop
  hermess_uninstall_old_done:
    FindClose $R0
  Delete "$INSTDIR\${MAINBINARYNAME}.old.exe"
  Delete "$INSTDIR\${MAINBINARYNAME}.next.exe"
  SetDetailsPrint both
!macroend
