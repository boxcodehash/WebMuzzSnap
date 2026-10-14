/* Local MuzzSnap stickers. A message stores [[sticker:<id>]] and both chats draw the SVG. */
(function (global) {
  var STICKERS = [
    { id: 'muzz', label: 'MUZZ', src: 'stickers/muzz.svg' },
    { id: 'moon', label: 'To the moon', src: 'stickers/to-the-moon.svg' },
    { id: 'soy-verga', label: 'Soy verga', src: 'stickers/soy-verga.svg' },
    { id: 'boss', label: 'The Boss', src: 'stickers/the-boss.svg' }
  ];

  function byId(id) {
    for (var i = 0; i < STICKERS.length; i += 1) {
      if (STICKERS[i].id === id) return STICKERS[i];
    }
    return null;
  }

  function token(id) {
    return '[[sticker:' + id + ']]';
  }

  function only(text) {
    return /^\[\[sticker:[a-z0-9-]+\]\]$/.test(String(text || '').trim());
  }

  function paint(node, text) {
    var raw = String(text || '');
    var re = /\[\[sticker:([a-z0-9-]+)\]\]/g;
    var last = 0;
    var match;
    var found = false;
    node.textContent = '';
    while ((match = re.exec(raw))) {
      found = true;
      if (match.index > last) node.appendChild(document.createTextNode(raw.slice(last, match.index)));
      var sticker = byId(match[1]);
      if (!sticker) {
        node.appendChild(document.createTextNode(match[0]));
      } else {
        var img = document.createElement('img');
        img.className = 'muzz-sticker';
        img.src = sticker.src;
        img.alt = sticker.label;
        node.appendChild(img);
      }
      last = match.index + match[0].length;
    }
    if (!found) {
      node.textContent = raw;
      return;
    }
    if (last < raw.length) node.appendChild(document.createTextNode(raw.slice(last)));
  }

  global.MuzzStickers = {
    list: STICKERS,
    token: token,
    only: only,
    paint: paint
  };
})(window);
