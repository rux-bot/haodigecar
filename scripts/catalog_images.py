"""Keep referenced vehicle images; delete unused extracted copies, not source DOCX."""
from pathlib import Path
import hashlib, json, shutil, sqlite3

SITE=Path(__file__).resolve().parents[1]
PUBLIC=SITE/'public'/'vehicles'
ARCHIVE=SITE/'docs'/'image-archive'

def checked(file,root):
    resolved=file.resolve()
    if not root.resolve().is_relative_to(SITE) or not resolved.is_relative_to(root.resolve()) or resolved==root.resolve():
        raise ValueError(f'Path outside permitted image root: {resolved}')
    for item in [file,*file.parents]:
        if item==SITE:break
        if item.is_symlink() or item.is_junction():raise ValueError(f'Linked path refused: {item}')
    return resolved

def sha(file):return hashlib.sha256(file.read_bytes()).hexdigest()

def locations(url):
    if not url.startswith('/vehicles/'):raise ValueError(f'Unexpected image URL: {url}')
    relative=Path(url.removeprefix('/vehicles/'))
    return checked(PUBLIC/relative,PUBLIC),checked(ARCHIVE/relative,ARCHIVE)

def sync_images(records,publish_from_archive=False):
    selected={url for item in records for url in item['images'] if url.startswith('/vehicles/')}
    PUBLIC.mkdir(parents=True,exist_ok=True)
    selections=[(url,*locations(url)) for url in sorted(selected)]
    unused=[]
    # Validate all resolved absolute targets before any deletion.
    for root in [PUBLIC,ARCHIVE]:
        if not root.exists():continue
        checked(root/'_boundary_check',root)
        for file in root.rglob('*'):
            if not file.is_file():continue
            file=checked(file,root)
            url='/vehicles/'+file.relative_to(root.resolve()).as_posix()
            if root==ARCHIVE or url not in selected:unused.append(file)
    for url,destination,archive in selections:
        if not destination.is_file() and not archive.is_file():raise FileNotFoundError(f'Referenced image missing: {url}')
    # Compatibility with older archives: preserve selected media before cleanup.
    for _,destination,archive in selections:
        if archive.is_file() and (not destination.is_file() or publish_from_archive):
            destination.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(archive,destination)
    expected={url:sha(destination) for url,destination,_ in selections}
    reclaimed=sum(file.stat().st_size for file in unused)
    for file in unused:file.unlink()
    for root in [PUBLIC,ARCHIVE]:
        if not root.exists():continue
        for folder in sorted((f for f in root.rglob('*') if f.is_dir()),key=lambda f:len(f.parts),reverse=True):
            checked(folder,root)
            if not any(folder.iterdir()):folder.rmdir()
    if ARCHIVE.exists() and not any(ARCHIVE.iterdir()):ARCHIVE.rmdir()
    for url,destination,_ in selections:
        if sha(destination)!=expected[url]:raise AssertionError(f'Referenced image changed: {url}')
    sources_path=SITE/'docs'/'extracted-sources.json'
    if sources_path.exists():
        sources=json.loads(sources_path.read_text(encoding='utf-8'))
        manifest=[]
        for source in sources:
            for image in source['images']:
                public,_=locations(image['path'])
                available=public.is_file()
                image['published']=image['path'] in selected
                image['storagePath']=public.relative_to(SITE).as_posix() if available else None
                image['removedUnusedCopy']=not available
                manifest.append({'url':image['path'] if available else None,'candidateUrl':image['path'],'published':image['published'],'storagePaths':[image['storagePath']] if available else [],'removedUnusedCopy':not available,'sourceFile':source['source'],'sourceImage':image['source'],'sourceSha256':image['sha256'],'webpSha256':sha(public) if available else None})
        sources_path.write_text(json.dumps(sources,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        (SITE/'docs'/'image-publication-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return {'publicImages':len(selected),'deletedUnusedCopies':len(unused),'reclaimedBytes':reclaimed}

if __name__=='__main__':
    database=SITE/'data'/'catalog.sqlite'
    if database.exists():
        with sqlite3.connect(database.as_uri()+'?mode=ro',uri=True) as db:
            records=[json.loads(row[0]) for row in db.execute('SELECT document FROM vehicles')]
    else:records=json.loads((SITE/'data'/'vehicles.json').read_text(encoding='utf-8'))
    print(json.dumps(sync_images(records),ensure_ascii=False))
