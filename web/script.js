const dummyWS = { send: () => {} };
let ws = dummyWS;

// If the window disconnects from the server, poll until it comes back and reload
function watchAndReload() {
  if (window.location.pathname === '/') {
    const TIMEOUT = 10000;
    function reload() {
      const req = new XMLHttpRequest();
      req.open('GET', window.location);
      req.onreadystatechange = function() {
        if (req.readyState === 4) {
          if (req.status === 200) {
            window.location.reload();
          }
          else {
            setTimeout(reload, TIMEOUT);
          }
        }
      }
      req.timeout = TIMEOUT;
      try {
        req.send(null);
      }
      catch (_) {
      }
    }
    setTimeout(reload, TIMEOUT);
  }
}

const onMessage = {
};

function runMessageManager() {
  ws = new WebSocket(`ws://${location.host}${location.pathname}ws${location.search}`);
  ws.addEventListener('close', () => {
    ws = dummyWS;
    watchAndReload();
  });
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    const fn = onMessage[msg.cmd];
    if (fn) {
      fn(msg);
    }
  });
}

const psend = {};
function send(cmd, value, delay) {
  const pkey = `${cmd}-${value && value.id}`;
  clearTimeout(psend[pkey]);
  if (delay !== undefined) {
    psend[pkey] = setTimeout(() => {
      send(cmd, value);
    }, delay * 1000);
  }
  else {
    ws.send(JSON.stringify({
      cmd: cmd,
      value: value
    }));
  }
}

onMessage['html.update'] = msg => {
  const node = document.getElementById(msg.value.id);
  if (node) {
    const active = document.activeElement;
    node.innerHTML = msg.value.html;
    if (active && active.id) {
      const elem = document.getElementById(active.id);
      if (elem && elem != active) {
        elem.replaceWith(active);
        active.focus();
      }
    }
    const scripts = node.getElementsByTagName('script');
    for (let i = 0; i < scripts.length; i++) {
      eval(scripts[i].innerText);
    }
  }
}

window.addEventListener('pageshow', runMessageManager);

// Sliders
const SHED = 32;
const transparentPixel = new Image(1,1);
transparentPixel.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
let sliderTimeSupport = document.createElement('div');
sliderTimeSupport.innerHTML = '<input type="time" value="not-a-time">';
if (sliderTimeSupport.firstElementChild.value === 'not-a-time') {
  sliderTimeSupport = false;
}
else {
  sliderTimeSupport = true;
}
function sliderSendUpdate(config) {
  send('slider.update', {
    id: config.id,
    high: parseFloat(config.high),
    low: parseFloat(config.low),
    time: config.time,
    trigger: config.trigger,
    rooms: config.rooms
  }, 0.5);
}
function sliderDragStart(e) {
  e.target._xoffset = e.clientX - e.target.offsetLeft;
  e.dataTransfer.setDragImage(transparentPixel, 0, 0);
}
function sliderDrag(e) {
  if (e.screenX === 0) {
    return;
  }
  const slider = e.target;
  const config = slider._config;
  const x = e.clientX - slider._xoffset;
  const width = slider.parentElement.clientWidth;
  const time = slider.querySelector(".time");
  if (x < 0) {
    config.time = '';
    if (time) {
      time.value = config.time;
      if (time.polyfill) {
        time.polyfill.update();
      }
    }
    slider.querySelector('.temp.top').innerText = '-';
    slider.querySelector('.temp.bottom').innerText = '-';
    slider.style.left = `${x > -SHED ? x : -SHED}px`;
    slider.firstElementChild._tippy.hide();
  }
  else {
    let mins = 5 * Math.floor((12 * 24) * x / width);
    if (mins >= 24 * 60) {
      mins = 24 * 60 - 1;
    }
    config.time = `${`0${Math.floor(mins / 60)}`.substr(-2)}:${`0${mins % 60}`.substr(-2)}`;
    if (time) {
      time.value = config.time;
      if (time.polyfill) {
        time.polyfill.update();
      }
    }
    slider.querySelector('.temp.top').innerText = config.high;
    slider.querySelector('.temp.bottom').innerText = config.low;
    slider.style.left = `${100 * mins / (24 * 60)}%`;
    slider.firstElementChild._tippy.show();
  }
  sliderSendUpdate(config);
}
function sliderOnChange(e) {
  let slider = e.target;
  while (!slider.classList.contains('slider')) {
    slider = slider.parentElement;
  }
  const config = slider._config;
  config.high = slider.querySelector('.slider-options .high').value;
  config.low = slider.querySelector('.slider-options .low').value;
  const trigger = slider.querySelector('.slider-options .trigger select').value;
  config.trigger = !trigger ? null : trigger;
  config.rooms = {};
  slider.querySelectorAll('.slider-options .room select').forEach(room => {
    switch (room.value) {
      case 'Always':
        config.rooms[room.name] = { always: true };
        break;
      case 'Occupied':
        config.rooms[room.name] = { occupied: true };
        break;
      default:
        break;
    }
  });
  slider.querySelector('.temp.top').innerText = config.high;
  slider.querySelector('.temp.bottom').innerText = config.low;
  sliderSendUpdate(config);
}
function sliderOnCreate(instance) {
  const slider = instance.reference.parentElement;
  const config = slider._config;
  slider.addEventListener("dragstart", sliderDragStart);
  slider.addEventListener("drag", sliderDrag);
  const width = slider.parentElement.clientWidth;
  if (config.time) {
    const time = config.time.split(':');
    const mins = parseInt(time[0], 10) * 60 + parseInt(time[1], 10);
    slider.style.left = `${100 * mins / (24 * 60)}%`;
  }
  else {
    slider.style.left = `${-SHED}px`;
  }
  slider.style.display = null;
}
function sliderOnDestroy(instance) {
  const slider = instance.reference.parentElement;
  slider.removeEventListener("dragstart", sliderDragStart);
  slider.removeEventListener("drag", sliderDrag);
}
function sliderOnShow(instance) {
  const slider = instance.reference.parentElement;
  const x = parseFloat(slider.style.left);
  if (x < 0) {
    return false;
  }
  return true;
}
function sliderOnShown(instance) {
  const slider = instance.reference.parentElement;
  slider.addEventListener('change', sliderOnChange);
  if (!sliderTimeSupport) {
    const time = slider.querySelector('input[type=time]');
    if (time && !time.polyfill) {
      new TimePolyfill(time);
    }
  }
}
function sliderOnHide(instance) {
  const slider = instance.reference.parentElement;
  const config = slider._config;
  if (parseFloat(slider.style.left) >= 0) {
    const itime = slider.querySelector('.slider-options .time');
    config.time = itime.dataset.value || itime.value;
    config.high = slider.querySelector('.slider-options .high').value;
    config.low = slider.querySelector('.slider-options .low').value;
    slider.querySelector('.temp.top').innerText = config.high;
    slider.querySelector('.temp.bottom').innerText = config.low;
    const time = config.time.split(':');
    const mins = parseInt(time[0], 10) * 60 + parseInt(time[1], 10);
    slider.style.left = `${100 * mins / (24 * 60)}%`;
  }
  slider.removeEventListener('change', sliderOnChange);
  sliderSendUpdate(config);
}
function sliderOnClickOutside(instance) {
  instance.hide();
}
function slider(config) {
  const elem = document.getElementById(config.id);
  elem._config = config;
  tippy(elem.querySelector('.slider-inner'), {
    theme: "material",
    trigger: "mousedown",
    placement: "left",
    interactive: true,
    hideOnClick: false,
    allowHTML: true,
    content: config.content,
    onCreate: sliderOnCreate,
    onDestroy: sliderOnDestroy,
    onShow: sliderOnShow,
    onShown: sliderOnShown,
    onHide: sliderOnHide,
    onClickOutside: sliderOnClickOutside
  });
}
