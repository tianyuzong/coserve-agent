$ErrorActionPreference='Stop'
$Src='D:\cf-build\official\src'; $Scripts='D:\castudio-env\cadflow-spike\Scripts'
$env:CADFLOW_OCCT_LIB_DIR='D:\castudio-env\occt-sdk\Library\lib'
$env:CMAKE_GENERATOR='Ninja'
$env:CMAKE_ARGS="-DCADFLOW_OCCT_SOURCE=D:/cf-build/official/src/third_party/occt"
$env:PATH="$Scripts;$env:PATH"
Push-Location $Src
cmd /c "`"D:\devin workspace\cadflow-core-win\vcenv.bat`" $Scripts\python.exe -m pip wheel . --no-deps --no-build-isolation -w D:\cf-build\dist\wheel"
Pop-Location
