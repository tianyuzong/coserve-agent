import zipfile,glob,os,subprocess,shutil
w=glob.glob(r'D:\cf-build\dist\wheel\*.whl')[0]
t=r'D:\cf-build\dist\wheel_unpack'; shutil.rmtree(t,ignore_errors=True); zipfile.ZipFile(w).extractall(t)
for f in glob.glob(r'D:\cf-build\dist\cadflow_native_official_win\*.dll'):
    if os.path.basename(f)!='cadflow_core.dll': shutil.copy(f,t+r'\cadflow')
r=subprocess.run([r'D:\castudio-env\cadflow-spike\Scripts\python.exe','-m','wheel','pack',t,'-d',r'D:\cf-build\dist\wheel_bundled'],capture_output=True,text=True)
print(r.stdout,r.stderr)
shutil.rmtree(t)
