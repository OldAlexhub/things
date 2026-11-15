"""Small ADB helper for actual emulator QA. Reads accessibility nodes before taps."""
import os, re, subprocess, sys, time, xml.etree.ElementTree as ET
from pathlib import Path
ADB = str(Path(os.environ['LOCALAPPDATA']) / 'Android/Sdk/platform-tools/adb.exe')
OUT = Path(__file__).resolve().parents[1] / '.local/qa'
OUT.mkdir(parents=True, exist_ok=True)
def adb(*args):
    return subprocess.check_output([ADB, *args], stderr=subprocess.STDOUT)
def nodes():
    adb('shell','uiautomator','dump','/sdcard/ttd-ui.xml')
    return list(ET.fromstring(adb('shell','cat','/sdcard/ttd-ui.xml')).iter('node'))
def find(label, kind=None):
    matches=[n for n in nodes() if label in (n.get('text'),n.get('content-desc')) and (not kind or kind in n.get('class',''))]
    matches.sort(key=lambda n: (n.get('class')!='android.widget.EditText',n.get('clickable')!='true'))
    return matches[0] if matches else None
def tap(label, scroll=False, kind=None):
    for _ in range(12 if scroll else 1):
        n=find(label,kind)
        if n is not None:
            x1,y1,x2,y2=map(int,re.findall(r'\d+',n.get('bounds')))
            if y2>y1 and x2>x1:
                adb('shell','input','tap',str((x1+x2)//2),str((y1+y2)//2));time.sleep(.45);return
        if scroll: adb('shell','input','swipe','540','1900','540','750','300')
    raise RuntimeError('Visible control missing: '+label)
def capture(name):
    (OUT/(name+'.png')).write_bytes(adb('exec-out','screencap','-p'))
    print('Captured '+name)
def dump():
    for n in nodes():
        label=n.get('text') or n.get('content-desc')
        if label:print(label.encode('ascii','replace').decode(),n.get('bounds'),n.get('class'))
if __name__=='__main__':
    action=sys.argv[1]
    if action=='dump':dump()
    elif action=='tap':tap(sys.argv[2],scroll='--scroll' in sys.argv,kind='Switch' if '--switch' in sys.argv else None)
    elif action=='capture':capture(sys.argv[2])
    elif action=='back':adb('shell','input','keyevent','4')
    elif action=='text':adb('shell','input','text',sys.argv[2].replace(' ','%s'))
    elif action=='swipe':adb('shell','input','swipe','540','1900','540','650','300')
