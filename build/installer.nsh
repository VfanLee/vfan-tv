; Must match USER_DATA_DIR_NAME in src/shared/constants/app-brand.ts
!define USER_DATA_DIR "vfantv"

!ifdef BUILD_UNINSTALLER

!include nsDialogs.nsh
!include LogicLib.nsh

Var DeleteUserDataCheckbox
Var DeleteUserDataChecked

!macro customUnInit
  StrCpy $DeleteUserDataChecked "0"
!macroend

; Replaces default uninstall welcome page with a checkbox (no MessageBox).
!macro customUnWelcomePage
  UninstPage custom un.UnUserDataOptionsShow un.UnUserDataOptionsLeave
!macroend

Function un.UnUserDataOptionsShow
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 12u "解除安装 $(^Name)"
  Pop $0

  ${NSD_CreateCheckbox} 0 18u 100% 12u "同时删除用户数据"
  Pop $DeleteUserDataCheckbox
  ${If} $DeleteUserDataChecked == "1"
    ${NSD_Check} $DeleteUserDataCheckbox
  ${Else}
    ${NSD_Uncheck} $DeleteUserDataCheckbox
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function un.UnUserDataOptionsLeave
  ${NSD_GetState} $DeleteUserDataCheckbox $0
  StrCpy $DeleteUserDataChecked $0
FunctionEnd

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ${If} $DeleteUserDataChecked == "1"
      SetShellVarContext current
      RMDir /r "$APPDATA\${USER_DATA_DIR}"
    ${EndIf}
  ${endIf}
!macroend

!endif
