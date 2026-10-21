; electron-builder 的 NSIS 自定义脚本（package.json build.nsis.include）。

!macro customInstall
  ; 1.14.3 改名「灵匣」：升级时旧版卸载程序会保留快捷方式，旧名字的快捷方式会指向已删除的旧版 exe，
  ; Windows 拿它找图标时显示白色空图标。安装程序有管理员权限，在这里删（所有用户安装时在公共桌面和公共开始菜单）。
  Delete "$DESKTOP\提示词助手.lnk"
  Delete "$SMPROGRAMS\提示词助手.lnk"
!macroend
