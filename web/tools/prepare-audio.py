"""Convert supplied float WAVs to compact browser PCM; preserve originals."""
from pathlib import Path
import struct, wave, json
import numpy as np
root=Path(__file__).resolve().parents[1]
out=root/'game/public/audio'; out.mkdir(parents=True,exist_ok=True)
manifest={}
for path in sorted((root/'sfx').rglob('*.wav')):
    raw=path.read_bytes(); pos=12; fmt=None; data=None
    while pos+8<=len(raw):
        kind=raw[pos:pos+4]; size=struct.unpack_from('<I',raw,pos+4)[0]
        chunk=raw[pos+8:pos+8+size]
        if kind==b'fmt ': fmt=chunk
        if kind==b'data': data=chunk
        pos+=8+size+(size%2)
    tag,ch,rate,_,_,bits=struct.unpack_from('<HHIIHH',fmt)
    if tag==3 and bits==32: samples=np.frombuffer(data,dtype='<f4').reshape(-1,ch).mean(axis=1)
    elif tag==1 and bits==16: samples=np.frombuffer(data,dtype='<i2').reshape(-1,ch).mean(axis=1)/32768
    elif tag==1 and bits==24:
        b=np.frombuffer(data,dtype=np.uint8).reshape(-1,3).astype(np.int32)
        v=b[:,0]|(b[:,1]<<8)|(b[:,2]<<16); v=(v^0x800000)-0x800000
        samples=v.reshape(-1,ch).mean(axis=1)/8388608
    else: raise ValueError((path.name,tag,bits))
    samples=np.nan_to_num(samples)
    active=np.flatnonzero(abs(samples)>0.001)
    if len(active): samples=samples[max(0,active[0]-int(rate*.012)):min(len(samples),active[-1]+int(rate*.14))]
    target=32000
    samples=np.interp(np.arange(int(len(samples)*target/rate))*rate/target,np.arange(len(samples)),samples)
    peak=max(float(abs(samples).max()),.001); samples*=min(1,.89/peak)
    name=('voice_' if path.parent.name=='announcer' else '')+path.stem.lower().replace(' ','_').replace('.','')+'.wav'
    with wave.open(str(out/name),'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(target); w.writeframes((np.clip(samples,-1,1)*32767).astype('<i2').tobytes())
    manifest[path.stem]=name
(root/'game/src/game/audioManifest.js').write_text('export const AUDIO_FILES = '+json.dumps(manifest,indent=2)+';\n')
print(f'{len(manifest)} clips; {sum(p.stat().st_size for p in out.glob("*.wav"))/1e6:.2f} MB browser audio')
