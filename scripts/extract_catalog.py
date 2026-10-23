"""Read the source DOCX files without editing them; extract auditable text and photos."""
from pathlib import Path
import zipfile, json, re, hashlib, io
from xml.etree import ElementTree as ET
from PIL import Image, ImageOps, ImageDraw, ImageFont

SITE = Path(__file__).resolve().parents[1]
ROOT = SITE.parent
NS = {'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}

def extract():
    out=[]
    # Raw extraction is private. Only reviewed catalog references may be published.
    media=SITE/'docs'/'image-archive'
    docs=SITE/'docs'
    media.mkdir(parents=True,exist_ok=True)
    docs.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((SITE/'scripts'/'catalog-sources.json').read_text(encoding='utf-8'))
    expected={x['file'] for x in manifest}
    actual={x.name for x in ROOT.glob('*.docx')}
    if expected != actual:
        raise ValueError('Source files changed; review catalog-sources.json and build_catalog.py before importing: '+str(expected ^ actual))
    for item in manifest:
        file=ROOT/item['file']
        key=item['id']
        dest=media/key
        dest.mkdir(exist_ok=True)
        with zipfile.ZipFile(file) as z:
            root=ET.fromstring(z.read('word/document.xml'))
            lines=[''.join(t.text or '' for t in p.findall('.//w:t', NS)).strip() for p in root.findall('.//w:p',NS)]
            lines=[x for x in lines if x]
            tables=[]
            for table in root.findall('.//w:tbl',NS):
                tables.append([[''.join(t.text or '' for t in c.findall('.//w:t',NS)) for c in row.findall('w:tc',NS)] for row in table.findall('w:tr',NS)])
            images=[]
            for name in z.namelist():
                if not name.startswith('word/media/'):
                    continue
                try:
                    raw=z.read(name)
                    im=Image.open(io.BytesIO(raw)); im.load()
                    if im.width<150 or im.height<100: continue
                    im=ImageOps.exif_transpose(im).convert('RGB')
                    im.thumbnail((1600,1600))
                    image_name=Path(name).stem+'.webp'
                    im.save(dest/image_name,'WEBP',quality=88)
                    images.append({'path':f'/vehicles/{key}/{image_name}','storagePath':f'docs/image-archive/{key}/{image_name}','published':False,'width':im.width,'height':im.height,'source':name,'sha256':hashlib.sha256(raw).hexdigest()})
                except Exception as exc:
                    print(file.name,name,str(exc))
            out.append({'id':key,'source':file.name,'lines':lines,'tables':tables,'images':images})
    (docs/'extracted-sources.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
    (docs/'extracted-sources.txt').write_text('\n\n'.join('\n'.join([x['id']+' '+x['source'],*x['lines']]) for x in out),encoding='utf-8')
    font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',16)
    all_imgs=[(x,img) for x in out for img in x['images']]
    for page in range((len(all_imgs)+39)//40):
        part=all_imgs[page*40:(page+1)*40]
        sheet=Image.new('RGB',(1200,((len(part)+3)//4)*220),'#eeeeee')
        dr=ImageDraw.Draw(sheet)
        for i,(x,img) in enumerate(part):
            im=Image.open(SITE/img['storagePath'])
            im.thumbnail((290,175))
            px=(i%4)*300+(300-im.width)//2; py=(i//4)*220
            sheet.paste(im,(px,py))
            label=x['id']+' / '+Path(img['path']).name
            dr.text(((i%4)*300+5,py+177),label,font=font,fill='#111111')
            dr.text(((i%4)*300+5,py+198),x['source'][:17],font=font,fill='#111111')
        sheet.save(docs/f'contact-sheet-{page+1}.jpg',quality=90)
    print(json.dumps({'documents':len(out),'images':len(all_imgs),'sheets':(len(all_imgs)+39)//40,'next':'Review images, then run build_catalog.py to publish selections and remove temporary copies.'},ensure_ascii=False))

if __name__=='__main__': extract()
