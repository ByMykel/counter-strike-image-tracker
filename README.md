<h1 align="center">Counter-Strike Image Tracker</h1>

## Fetching Images

To get images, fetch the JSON file:

```bash
https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/refs/heads/main/static/images.json
```

The JSON structure contains the `image_inventory` as the key and the official CDN image URL as the value:

```json
{
    "econ/stickers/cologne2014/titan_foil_1355_37": "https://cdn.steamstatic.com/apps/730/icons/econ/stickers/cologne2014/titan_foil_1355_37.3dbb3370f9e2351f2d025f4c50c08e8ae3285b20.png",
    "econ/stickers/cologne2014/titan_holo": "https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJai0ki7VeTHjMmuOXSQ61MnpNagpU3uVRz_oZ7v8S0VuqX3PvE_eKKXXGaSxLgn5rhvFnC1lEsk4m7Tz4v9dXnEbFB2DMR3TflK7Ecql-bHIw",
    "econ/stickers/cologne2014/titan_holo_1355_37": "https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJai0ki7VeTHjMmuOXSQ61MnpNagpU3uVRz_oZ7v8S1kvqH7PZs-d77GWmbAmOp3sbdrTSixwht04ziAwt6qcnyfPFUgXMN5QOMC4xG-k4e1Kaq8sFG6vUcn",
    "econ/stickers/cologne2014/virtuspro": "https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJai0ki7VeTHjMmuOXSQ61MnpNagpU_uUwnkjYby8mxZuaqqPadvc6GXWjHEkbsltLZrFi-3xEp0sG3Um434dC_GbwIjCcFxW6dU5ZvHl6hL",
    "econ/stickers/cologne2014/virtuspro_1355_37": "https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJai0ki7VeTHjMmuOXSQ61MnpNagpU_uUwnkjYby8h0KvKf7V_c6bqnHVzSVxb8isbBsGHHhlE5ysGnVwov6IniRbQAjWJN3E7MM4USxw4D5d7S1J6z3NXU",
    "econ/stickers/cologne2014/virtuspro_foil": "https://cdn.steamstatic.com/apps/730/icons/econ/stickers/cologne2014/virtuspro_foil.a82440c1d4aa3c55dd3b894e117793d8e696e63c.png",
    ...
}
```

### Fallback Images

If an image does not exist in `images.json`, check if it exists using this base URL:

```bash
https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/refs/heads/main/static/panorama/images/
```

Simply append the `image_inventory` path to the base URL to get the fallback image.

For example, some images don't have a CDN URL:

```bash
https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/main/static/panorama/images/econ/set_icons/set_inferno_2_png.png
```

You can see the full list of 300+ images without a CDN image at: **[bymykel.com/counter-strike-items](https://bymykel.com/counter-strike-items/#/home?image_domain=raw.githubusercontent.com)**
