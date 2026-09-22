# arxdl

Compact media downloader for Node.js 20 or newer.

```bash
npm install github:muleff/arxdl
```

```js
import arxdl from 'arxdl'

const youtube = await arxdl.youtube.download('https://youtu.be/jNQXAC9IVRw', {
  type: 'audio',
  quality: '128'
})

const tiktok = await arxdl.tiktok.download('https://www.tiktok.com/@user/video/123')
const headers = await arxdl.tiktok.downloadHeaders()
delete headers.__impersonate

await fetch(tiktok.datos.url, { headers })
```

