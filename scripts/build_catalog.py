"""Build reviewed seed data. Run extract_catalog.py first. Never edits source DOCX."""
from pathlib import Path
import json,re
from collections import Counter
from PIL import Image, ImageDraw, ImageFont
from catalog_images import sync_images,locations
SITE=Path(__file__).resolve().parents[1]
SOURCES=json.loads((SITE/'docs'/'extracted-sources.json').read_text(encoding='utf-8'))
MANIFEST=json.loads((SITE/'scripts'/'catalog-sources.json').read_text(encoding='utf-8'))
assert [(x['id'],x['source']) for x in SOURCES]==[(x['id'],x['file']) for x in MANIFEST], 'Source ordering changed; review mappings before building.'
# Cover photo first; the selected images were visually checked.
PHOTOS={1:[3,1,7,10,11,9],3:[5,1,3,4,6,8],4:[4,5,2,8,11,12],5:[3,5,1,4,7],6:[2,1,3,5,4,6],7:[3,2,4,11,12,9],8:[6,2,7,8,9,10],9:[4,2,5,7,11,12],10:[5,6,1,10,8,9],11:[2,1,3],12:[2,1,7,4,5,12],13:[6,5,2,7,8],14:[4,7,3,9,10,11],15:[4,1,5,8,12,13],16:[4,2,5,6,7,9],17:[5,2,3,6,8],18:[5,3,4,2,6],19:[4,7,2,6,12,13],20:[4,5,2,6,8],21:[2,4,7,9,10],22:[5,4,2,10,11,12],23:[13,15,16,17,9,11,3,4,5],24:[7,3,2,12,14,15],25:[6,7,2,10,13,14],26:[3,2,1,11,9,10],27:[2,1],28:[4,1,2,3,5,8],29:[1,2,3,4,5,6],30:[2,1,3,8,9],31:[2,3,1,4,5],32:[4,2,1,3,7,8]}
BRANDS={1:'东风',3:'东风',4:'五菱',5:'凯翼 / 开瑞',6:'凯马',7:'凯马',8:'吉利远程',9:'吉利远程',10:'吉利远程',11:'吉利远程',12:'奇瑞',13:'开瑞',14:'开瑞',15:'江淮',16:'江淮',17:'江淮',18:'江淮',19:'江淮',20:'江淮',21:'江淮',22:'瑞驰',23:'福田',24:'福田',25:'福田',26:'福田',27:'福田',28:'福田',29:'福田',30:'贵州长江',31:'吉利远程',32:'金旅'}
VOLUMES={1:'6方',4:'7方',7:'6方',14:'6方',15:'8方',17:'10方',20:'6方',23:'7 / 8 / 9方',24:'6方',30:'6方'}
BODY={6:'厢货',11:'厢货',13:'平板',18:'平板',21:'厢货',26:'厢货',27:'厢货',28:'平板',31:'平板'}
NOTES={1:'“东风6方车”和“东风六方车”的正文和全部11张图片内容一致，合并为1款。',3:'原文同时写7.3方与8方，电机峰值功率110km、最高车速100/km单位有误，冲突参数未发布。',6:'参数人工读取自文档内“凯马凯捷EM6电动冷藏车参数表”，对应提取图image6.webp。',12:'原文含准新车车况、上牌时间、里程及特定租购报价；这些属于单车历史信息，未作为车型普遍承诺发布。',19:'文件名写七方，正文写六方；暂使用不带容积数字的车型名，容积待核实。',23:'原文版本电量前段取整60/66，后段60.37/66.67；按续航对应版本保留。具体版本需确认。尺寸单位原文未标。',27:'原文称标箱，按厢货归类；照片以驾驶室及底盘为主，最终上装形式需确认。',28:'原文栏板高400mm，照片为低栏板，按平板分类，不归高栏。'}
def pair(k,v):return {'label':k,'value':v}
def pairs(items):return [pair(k,v) for k,v in items]
def build():
 records=[];audits=[]
 for num,src in enumerate(SOURCES,1):
  if num==2:continue
  name=src['source'].removesuffix('.docx').replace('\xa0',' ')
  if num==1:name='东风六方车'
  if num==19:name='江淮蓝猫客运版'
  temp='冷藏' if '冷藏' in name else '常温';body=BODY.get(num,'面包')
  lines=src['lines'][1:];specs=[]
  for line in lines:
   if line.startswith(('[视频]','上牌时间','行驶公里数','以租代购方案','首付')):continue
   if '：' in line:
    k,v=line.split('：',1)
    if v:specs.append(pair(k,v.replace('*',' × ')))
   elif '电池' in line:specs.append(pair('动力电池',line))
   elif re.match(r'限[座载]\d+人',line):specs.append(pair('座位数',line[2:]))
   elif '门' in line or '自带' in line:specs.append(pair('配置',line))
  battery=next((s for s in lines if '电池' in s),'').replace('中航电池电池','中航电池')
  range_=next((s.split('：',1)[1] for s in lines if s.startswith('续航：')),'')
  dimensions=next((s.split('：',1)[1].replace('*',' × ') for s in lines if any(k in s for k in ['货箱尺寸','货厢尺寸','车厢尺寸']) and '：' in s),'')
  payload=next((s.split('：',1)[1] for s in lines if re.match(r'(额定载重|额定载质量|核载)：',s)),'')
  description=f'{BRANDS[num]}{temp}{body}车型，可咨询租赁或购买方案。'
  highlights=[temp,body]+(['客运版'] if '客运版' in name else [])
  if num==3:
   battery='宁德时代53.58度';range_='355km';dimensions='3040 × 1760 × 1360mm'
   specs=pairs([('动力电池',battery),('续航',range_),('车身外尺寸','5270 × 1890 × 1998mm'),('货厢尺寸',dimensions),('轮包间距','1350mm'),('驱动形式','后置后驱'),('车门','右侧滑门 / 270°对开尾门'),('配置','快慢充、13寸中控屏、倒车影像、PVC货箱地板')])
   description='后置后驱货运版，右侧滑门与270°对开尾门，标配快慢充和倒车影像。'
  if num==6:
   battery='亿纬140.15kWh';range_='400km'
   specs=pairs([('车辆类型','纯电动冷藏车'),('动力电池',battery),('电池种类','磷酸铁锂电池'),('续航里程',range_),('电机生产商','汇川'),('电机功率','70 / 140kW'),('驾驶室宽度','2030mm'),('充电方式','双快充，0–80%约30分钟'),('冷却方式','液冷、液热'),('座位数','3座'),('轴距','3500mm'),('安全系统','ESC、ABS、AEBS、LDWS')])
   description='亿纬140.15kWh电池，双快充，2030mm宽体驾驶室。'
  if num==23:
   battery='40.18 / 41.86 / 50.23 / 60.37 / 66.67度';range_='300–460km（按版本）';dimensions='2800 / 3100 × 1760 × 1450 / 1650（按版本，原文）'
   specs=pairs([('可选车厢','7方 / 8方 / 9方'),('7方外尺寸','4885 × 1810 × 1960（原文）'),('7方货箱','2800 × 1760 × 1450（原文）'),('8方外尺寸','5185 × 1810 × 1960（原文）'),('8方货箱','3100 × 1760 × 1450（原文）'),('9方外尺寸','5185 × 1810 × 2160（原文）'),('9方货箱','3100 × 1760 × 1650（原文）'),('续航对应版本','40.18/41.86度：300km；50.23度：350km；60.37度：400km；宁德66.67度：460km'),('电机','125 / 120kW'),('客运版座位数','4 / 6 / 7 / 9座'),('标配','6.6kW慢充、220V车内取电、12.8寸中控屏、倒车影像'),('选装','L2+级辅助驾驶')])
   description='可选7方、8方、9方车厢，提供客运与货运版本，多种电池配置。';highlights=['常温','面包','多种版本']
  if num==27:
   dimensions='4.14 × 2.1 × 2.3 / 4.14 × 2.35 × 2.3（原文）'
   specs=pairs([('动力电池',battery),('续航',range_),('货厢尺寸（原文）',dimensions),('车厢宽度说明','标箱2.1，可做2.35（原文）'),('总质量','4495kg'),('整备质量','2565kg')])
  if num==28:specs=pairs([('动力电池',battery),('续航',range_),('货箱尺寸（原文）',dimensions),('总质量','4495kg'),('栏板高度','400mm')])
  if num==29:
   battery='宁德时代66.67度 / 爱易科60.37度';range_='450km / 420km（按版本）';dimensions='3.1 × 1.76 × 1.65m'
   specs=pairs([('版本一','宁德时代66.67度，续航450km，自带2C超充'),('版本二','爱易科60.37度，续航420km'),('车身','长轴中顶'),('轴距','3400mm'),('外轮廓尺寸','5.195 × 1.81 × 2.16m'),('货厢尺寸',dimensions),('最高车速','100km/h'),('配置','V2L外放电、ABS、EBD、倒车影像、定速巡航'),('总重量','3300kg'),('整备质量','1790kg'),('轮胎','195/75R16LT'),('驱动方式','前置前驱'),('座位数','2人')])
   description='长轴中顶，提供宁德时代66.67度与爱易科60.37度两种电池版本。'
  for s in specs:
   if '尺寸' in s['label'] and not re.search(r'mm|米|m',s['value']) and '原文' not in s['label']:s['label']+='（原文）'
  imgs=[f'/vehicles/{src["id"]}/image{i}.webp' for i in PHOTOS[num]]
  for path in imgs:assert any(p.is_file() for p in locations(path)),path
  sources=[src['source']]+([SOURCES[1]['source']] if num==1 else [])
  records.append(dict(id=src['id'],name=name,brand=BRANDS[num],temperature=temp,bodyType=body,bodyTypes=[body],published=True,availability='待确认',description=description,highlights=highlights,specs=specs,images=imgs,sourceFiles=sources,battery=battery,range=range_,cargoVolume=VOLUMES.get(num,''),payload=payload,dimensions=dimensions))
  if num in NOTES:audits.append(dict(id=src['id'],name=name,note=NOTES[num],sourceFiles=sources))
 sync_images(records,publish_from_archive=True)
 (SITE/'data').mkdir(exist_ok=True)
 (SITE/'data'/'vehicles.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 (SITE/'docs'/'catalog-audit.json').write_text(json.dumps(audits,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',17);sheet=Image.new('RGB',(1200,1800),'#f2f4f5');draw=ImageDraw.Draw(sheet)
 for i,v in enumerate(records):
  im=Image.open(SITE/'public'/v['images'][0].lstrip('/'));im.thumbnail((290,175));x=(i%4)*300;y=(i//4)*225
  sheet.paste(im,(x+(300-im.width)//2,y));draw.text((x+6,y+179),v['id']+'  '+v['temperature']+' / '+v['bodyType'],font=font,fill='#111');draw.text((x+6,y+202),v['name'][:18],font=font,fill='#111')
 sheet.save(SITE/'docs'/'catalog-covers.jpg',quality=92)
 summary={'models':len(records),'temperature':dict(Counter(v['temperature'] for v in records)),'bodyTypes':dict(Counter(v['bodyType'] for v in records)),'selectedImages':sum(len(v['images']) for v in records)}
 (SITE/'docs'/'catalog-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(summary,ensure_ascii=False))
if __name__=='__main__':build()
