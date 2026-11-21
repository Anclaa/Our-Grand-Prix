'use strict';

(() => {
  const memoryData = window.anniversaryMemories;
  const $ = (id) => document.getElementById(id);
  const state = {
    mode: 'intro', visited: 0, x: 0, z: 0, heading: 0, speed: 0,
    overview: false, assisted: false, nearby: -1, lights: 0,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  motionPreference.addEventListener('change', (event) => { state.reducedMotion = event.matches; });
  const allVisited = (1 << memoryData.length) - 1;
  const keys = new Set();
  const pointers = new Map();
  const pulses = new Map();
  const controlButtons = [...document.querySelectorAll('[data-control]')];
  const lights = [...document.querySelectorAll('.starting-lights i')];
  const dialogs = [$('album'), $('memory-dialog'), $('finish')];
  const photoDialog = $('memory-dialog');
  const album = $('album');
  const music = $('music');
  const map = $('minimap');
  const ink = map.getContext('2d');
  const data = window.grandPrixWorld;
  const keyToControl = new Map([
    ['arrowup','forward'], ['w','forward'], ['arrowdown','reverse'], ['s','reverse'],
    ['arrowleft','left'], ['a','left'], ['arrowright','right'], ['d','right'], [' ','brake'],
  ]);
  const cards = [];
  let world = null;
  let track = null;
  let routeImage = null;
  let previousFrame = 0;
  let previousHUD = 0;
  let progressStarted = false;
  let finishReached = false;
  let storyMode = false;
  let guidedPosition = null;
  let openMemoryIndex = 0;
  let openPhotoIndex = 0;
  let photoOrigin = 'track';
  let audioPreference = 'default';
  let lastRender = 0;

  const isUnlocked = (index) => Boolean(state.visited & (1 << index));
  const photoURL = (number) => './assets/recuerdo-' + String(number).padStart(2, '0') + '.webp';
  const wrap = (n) => (n + 1) % 1;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const turnBy = (previous, next, fraction) => previous + Math.atan2(Math.sin(next - previous), Math.cos(next - previous)) * fraction;
  const ahead = (from, to) => wrap(to - from);
  const announced = (message) => { $('announcement').textContent = message; };
  const dialogOpen = () => dialogs.some((element) => element.open);
  const destination = () => memoryData.findIndex((_, index) => !isUnlocked(index));

  try {
    track = data.trackModel();
    world = data.create($('world'), track);
  } catch (error) {
    console.info('No se pudo iniciar el circuito 3D.', error.message);
    enableStoryMode();
  }

  $('world').addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    world = null;
    enableStoryMode();
  }, true);

  function enableStoryMode() {
    storyMode = true;
    $('compatibility').hidden = false;
    $('start-race').hidden = true;
    $('countdown').hidden = true;
    $('overview').hidden = true;
    $('hud').hidden = true;
    $('drive-ui').hidden = true;
    $('interact').hidden = true;
    $('welcome').hidden = false;
    setMode('intro');
    announced('Modo de recuerdos disponible.');
  }

  function clearControls() {
    keys.clear();
    pointers.clear();
    pulses.clear();
    controlButtons.forEach((button) => button.classList.remove('active'));
  }

  function pressed(control, now) {
    return keys.has(control) || [...pointers.values()].some((pointer) => pointer.control === control) || (pulses.get(control) || 0) > now;
  }

  function placeOnTrack(fraction) {
    if (!track) return;
    const point = track.spline.getPointAt(fraction);
    const tangent = track.spline.getTangentAt(fraction);
    state.x = point.x;
    state.z = point.z;
    state.speed = 0;
    state.heading = Math.atan2(tangent.x, tangent.z);
    guidedPosition = null;
  }

  function setMode(mode) {
    state.mode = mode;
    $('experience').dataset.phase = mode;
  }

  function setView(active) {
    state.overview = active;
    $('overview').setAttribute('aria-pressed', String(active));
    $('map-card').classList.toggle('map-shown', active);
  }

  function setAssisted(active) {
    state.assisted = active;
    guidedPosition = null;
    $('assist').setAttribute('aria-pressed', String(active));
    if (state.mode === 'drive') announced(active ? 'Pilotaje asistido activado.' : 'Pilotaje asistido desactivado.');
  }

  function holdPosition() {
    state.speed = 0;
    clearControls();
  }

  function drawMapBase() {
    if (!track || !ink) return;
    routeImage = document.createElement('canvas');
    routeImage.width = map.width;
    routeImage.height = map.height;
    const drawing = routeImage.getContext('2d');
    const fit = (x,z) => [96 + x * 1.55, 72 + z * 1.42];
    drawing.beginPath();
    track.samples.forEach((point,index) => {
      const [x,y] = fit(point.x,point.z);
      if(index) drawing.lineTo(x,y);
      else drawing.moveTo(x,y);
    });
    drawing.closePath();
    drawing.strokeStyle = '#51405c';
    drawing.lineWidth = 8;
    drawing.stroke();
    drawing.strokeStyle = '#b39ebd';
    drawing.lineWidth = 1.8;
    drawing.stroke();
    const start = track.samples[0];
    const [x,y] = fit(start.x,start.z);
    drawing.fillStyle = '#e9d2b6';
    drawing.fillRect(x-2,y-4,3,8);
  }

  function updateHUD() {
    if (!track || storyMode) return;
    const unlocked = memoryData.filter((_,index) => isUnlocked(index)).length;
    $('memory-count').textContent = unlocked + ' / ' + memoryData.length;
    $('race-stage').textContent = finishReached ? 'Vuelta completa' : state.assisted ? 'Pilotaje asistido' : 'En pista';
    const next = destination();
    $('next-stop').textContent = finishReached ? 'Todos los recuerdos' : next < 0 ? 'Vuelve a la parrilla para ver la carta' : 'Siguiente parada · ' + track.stations[next].name;
    const action = $('interact');
    const eligible = state.mode === 'drive' && (state.nearby >= 0 || state.nearby === -2);
    action.hidden = !eligible;
    if (eligible) {
      action.textContent = state.nearby === -2 ? (finishReached ? 'Leer la carta' : 'Cruzar la meta') : (isUnlocked(state.nearby) ? 'Volver a ver · ' : 'Abrir recuerdo · ') + track.stations[state.nearby].name;
    }
    if (!ink || !routeImage) return;
    ink.clearRect(0, 0, map.width, map.height);
    ink.drawImage(routeImage,0,0);
    track.stations.forEach(({point,tint},index) => {
      const x = 96 + point.x * 1.55;
      const y = 72 + point.z * 1.42;
      ink.beginPath();
      ink.arc(x,y,index === next ? 4.9 : 3.7,0,Math.PI*2);
      ink.fillStyle = isUnlocked(index) ? '#9fdbaf' : index === next ? tint : '#99809e';
      ink.fill();
      if (index === next) {
        ink.strokeStyle = '#ffe2cc';
        ink.lineWidth = .85;
        ink.stroke();
      }
    });
    ink.beginPath();
    ink.arc(96 + state.x * 1.55,72 + state.z * 1.42,3.65,0,Math.PI*2);
    ink.fillStyle = '#fff0bb';
    ink.fill();
  }

  function syncAlbum() {
    const unlocked = memoryData.filter((_,index) => isUnlocked(index)).length;
    $('album-help').textContent = unlocked
      ? unlocked + ' de ' + memoryData.length + ' paradas descubiertas. Elige un recuerdo para ver sus fotos.'
      : 'Las fotos se guardan aquí al abrir los recuerdos del circuito.';
    cards.forEach(({ button, cover, detail }, index) => {
      const ready = isUnlocked(index);
      button.disabled = !ready;
      const count = memoryData[index].photos.length;
      detail.textContent = ready ? count + (count === 1 ? ' foto' : ' fotos') : 'Por descubrir';
      if (ready && !cover.querySelector('img')) {
        const photo = memoryData[index].photos[0];
        const picture = document.createElement('img');
        picture.src = photoURL(photo[0]);
        picture.loading = 'lazy';
        picture.alt = '';
        picture.style.objectPosition = photo[3];
        cover.replaceChildren(picture);
      } else if (!ready) {
        cover.textContent = '♡';
      }
    });
  }

  function createAlbum() {
    memoryData.forEach((memory,index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'album-card';
      const cover = document.createElement('span');
      cover.className = 'album-cover';
      cover.setAttribute('aria-hidden','true');
      const title = document.createElement('strong');
      title.textContent = memory.title;
      const detail = document.createElement('small');
      button.append(cover,title,detail);
      button.addEventListener('click',() => showMemory(index,'album'));
      $('album-grid').append(button);
      cards.push({ button, cover, detail });
    });
    syncAlbum();
  }

  function showAlbum() {
    holdPosition();
    syncAlbum();
    if (!album.open) album.showModal();
  }

  function showPhoto(index) {
    const memory = memoryData[openMemoryIndex];
    openPhotoIndex = (index + memory.photos.length) % memory.photos.length;
    const [number,caption,alt] = memory.photos[openPhotoIndex];
    const img = $('memory-image');
    img.alt = alt;
    img.src = photoURL(number);
    img.classList.remove('reveal');
    requestAnimationFrame(() => { requestAnimationFrame(() => img.classList.add('reveal')); });
    $('photo-caption').textContent = caption;
    $('photo-count').textContent = (openPhotoIndex + 1) + ' / ' + memory.photos.length;
    for (const id of ['previous-photo','next-photo']) $(id).hidden = memory.photos.length === 1;
    if (memory.photos.length > 1) {
      const next = new Image();
      next.src = photoURL(memory.photos[(openPhotoIndex + 1) % memory.photos.length][0]);
    }
  }

  function showMemory(index,origin) {
    if (photoDialog.open || index < 0) return;
    holdPosition();
    photoOrigin = origin;
    if (origin !== 'album') state.visited |= 1 << index;
    openMemoryIndex = index;
    $('memory-sector').textContent = 'PARADA ' + String(index+1).padStart(2,'0') + ' / ' + String(memoryData.length).padStart(2,'0');
    $('memory-title').textContent = memoryData[index].title;
    $('memory-story').textContent = memoryData[index].story;
    $('continue-race').textContent = origin === 'album' ? 'Volver al álbum' : storyMode ? (destination() < 0 ? 'Leer la carta' : 'Siguiente parada') : 'Volver a la pista';
    showPhoto(0);
    photoDialog.showModal();
    $('memory-title').focus({ preventScroll: true });
    updateHUD();
  }

  function showFinish() {
    if ($('finish').open) return;
    holdPosition();
    finishReached = true;
    setAssisted(false);
    $('finish').showModal();
    $('finish-title').focus({ preventScroll: true });
    updateHUD();
  }

  function showStoryStep() {
    const index = destination();
    if (index < 0) showFinish();
    else showMemory(index,'story');
  }

  function musicControls() {
    function update() {
      const active = !music.paused && !music.ended;
      $('sound').setAttribute('aria-pressed',String(active));
      $('sound').setAttribute('aria-label',active ? 'Pausar música' : 'Activar música');
    }
    music.addEventListener('playing',update);
    music.addEventListener('pause',update);
    $('sound').addEventListener('click', () => {
      if (music.paused) {
        audioPreference = 'on';
        playMusic();
      } else {
        audioPreference = 'off';
        music.pause();
      }
    });
  }

  function playMusic() {
    if(audioPreference === 'off') return;
    music.volume = .44;
    music.play().catch(() => {});
  }

  function showTrack() {
    $('welcome').hidden = true;
    $('scene-caption').hidden = true;
    $('countdown').hidden = true;
    $('hud').hidden = false;
    $('drive-ui').hidden = false;
    $('overview').hidden = false;
    setMode('drive');
    updateHUD();
    $('experience').focus({ preventScroll:true });
  }

  async function startRace() {
    if (progressStarted) {
      showTrack();
      return;
    }
    if (state.mode !== 'intro' || storyMode) return;
    setMode('countdown');
    playMusic();
    $('welcome').hidden = true;
    $('scene-caption').hidden = true;
    $('countdown').hidden = false;
    for (let index = 0; index < lights.length; index += 1) {
      lights[index].classList.add('lit');
      state.lights = index + 1;
      $('countdown-label').textContent = 'En la parrilla · ' + state.lights;
      await new Promise((resolve) => setTimeout(resolve,index===lights.length-1 ? 720 : 380));
      if (storyMode) return;
    }
    state.lights = 0;
    lights.forEach((light) => light.classList.remove('lit'));
    $('countdown-label').textContent = '¡Luces fuera!';
    announced('Luces fuera. Usa las flechas o los controles táctiles para conducir.');
    await new Promise((resolve) => setTimeout(resolve,430));
    if (storyMode) return;
    progressStarted = true;
    showTrack();
  }

  function goHome() {
    if (state.mode === 'countdown' || !progressStarted) return;
    holdPosition();
    setAssisted(false);
    setView(false);
    setMode('intro');
    $('welcome').hidden = false;
    $('scene-caption').hidden = false;
    $('hud').hidden = true;
    $('drive-ui').hidden = true;
    $('interact').hidden = true;
    $('overview').hidden = true;
    $('start-race').lastChild.textContent = ' Reanudar la vuelta';
    $('start-race').focus({ preventScroll:true });
  }

  function resetRace() {
    state.visited = 0;
    finishReached = false;
    progressStarted = false;
    holdPosition();
    setView(false);
    setAssisted(false);
    placeOnTrack(.982);
    syncAlbum();
    setMode('intro');
    $('welcome').hidden = false;
    $('scene-caption').hidden = false;
    $('hud').hidden = true;
    $('drive-ui').hidden = true;
    $('interact').hidden = true;
    $('overview').hidden = true;
    $('countdown-label').textContent = 'En la parrilla';
    $('start-race').lastChild.textContent = ' Entrar al circuito';
  }

  function trackInteract() {
    if (state.mode !== 'drive' || dialogOpen()) return;
    if (state.nearby === -2) showFinish();
    if (state.nearby >= 0) showMemory(state.nearby,'track');
  }

  function nearestInteract() {
    const start = track.samples[0];
    if (state.visited === allVisited && Math.hypot(state.x - start.x, state.z - start.z) < 7) return -2;
    let found = -1;
    let closest = 7.15;
    track.stations.forEach(({point},index) => {
      const distance = Math.hypot(state.x - point.x, state.z - point.z);
      if (distance < closest) {
        found = index;
        closest = distance;
      }
    });
    return found;
  }

  function guided(dt) {
    const next = destination();
    const goal = next < 0 ? 0 : track.stations[next].fraction;
    if (guidedPosition === null) guidedPosition = track.nearest(state.x,state.z).fraction;
    const target = track.spline.getPointAt(guidedPosition);
    const distance = Math.hypot(state.x - target.x,state.z - target.z);
    if (distance > .72) {
      const angle = Math.atan2(target.x - state.x,target.z - state.z);
      state.heading = turnBy(state.heading,angle,1-Math.exp(-dt * 5.6));
      const advance = Math.min(distance, dt * 16);
      state.x += (target.x - state.x) / distance * advance;
      state.z += (target.z - state.z) / distance * advance;
      return;
    }
    const progress = ahead(guidedPosition,goal);
    if (progress > .988 || progress < .012) {
      placeOnTrack(goal);
      state.nearby = next < 0 ? -2 : next;
      trackInteract();
      return;
    }
    guidedPosition = wrap(guidedPosition + Math.min(progress, dt * 27 / track.length));
    const point = track.spline.getPointAt(guidedPosition);
    const tangent = track.spline.getTangentAt(guidedPosition);
    state.heading = turnBy(state.heading,Math.atan2(tangent.x,tangent.z),1-Math.exp(-dt * 8));
    state.x = point.x;
    state.z = point.z;
  }

  function manual(dt,now) {
    const forward = pressed('forward',now);
    const back = pressed('reverse',now);
    const braking = pressed('brake',now);
    const turn = Number(pressed('right',now)) - Number(pressed('left',now));
    const road = track.nearest(state.x,state.z);
    const onRoad = road.distance <= 4.5;
    const maxSpeed = onRoad ? 24.5 : 12;
    const pull = Number(forward) - Number(back);
    if (!braking && pull) {
      const pushingAgainstMotion = pull * state.speed < 0;
      state.speed = clamp(state.speed + pull * dt * (pushingAgainstMotion ? 28 : 15), -8, maxSpeed);
    } else {
      const drag = braking ? 49 : onRoad ? 7.8 : 12;
      state.speed = Math.sign(state.speed) * Math.max(0,Math.abs(state.speed) - dt * drag);
    }
    if (turn && Math.abs(state.speed) > .12) {
      const response = Math.min(.98, .42 + Math.abs(state.speed) / 21);
      state.heading -= turn * 2.15 * dt * Math.sign(state.speed) * response;
    }
    const nx = state.x + Math.sin(state.heading) * state.speed * dt;
    const nz = state.z + Math.cos(state.heading) * state.speed * dt;
    const limit = (Math.abs(nx) / 63.8) ** 3.2 + (Math.abs(nz) / 53.4) ** 3.1;
    if (limit > .98 || world.obstacleAt(nx,nz) && !world.obstacleAt(state.x,state.z)) {
      state.speed *= .22;
      return;
    }
    state.x = nx;
    state.z = nz;
  }

  function animate(now) {
    const dt = Math.min(Math.max((now - (previousFrame || now)) / 1000, .001), .13);
    previousFrame = now;
    if (world && !document.hidden) {
      if (state.mode === 'drive' && !dialogOpen()) {
        if (state.assisted) guided(dt);
        else manual(dt,now);
        state.nearby = nearestInteract();
        if (!finishReached && state.nearby === -2 && !dialogOpen()) showFinish();
        controlButtons.forEach((button) => button.classList.toggle('active',pressed(button.dataset.control,now)));
      }
      if (now - previousHUD >= 100) {
        updateHUD();
        previousHUD = now;
      }
      const interval = world.isSoftware ? (state.mode === 'intro' ? 76 : 37) : 15;
      if (now - lastRender >= interval) {
        world.render(state,Math.min((now - (lastRender || now - 16)) / 1000,.22),now);
        lastRender=now;
      }
    }
    requestAnimationFrame(animate);
  }

  function createControls() {
    for (const button of controlButtons) {
      const { control } = button.dataset;
      button.addEventListener('pointerdown', (event) => {
        if(event.button !== 0 || state.mode !== 'drive' || dialogOpen()) return;
        if (state.assisted) setAssisted(false);
        button.setPointerCapture(event.pointerId);
        pointers.set(event.pointerId, {control,start:performance.now()});
      });
      button.addEventListener('pointerup',(event) => {
        const pointer = pointers.get(event.pointerId);
        pointers.delete(event.pointerId);
        if(pointer && performance.now() - pointer.start < 160) pulses.set(control,performance.now() + 410);
      });
      for(const type of ['pointercancel','lostpointercapture']) button.addEventListener(type,(event)=>pointers.delete(event.pointerId));
      button.addEventListener('click',(event)=>{
        if(event.detail !== 0 || state.mode !== 'drive' || dialogOpen()) return;
        if (state.assisted) setAssisted(false);
        pulses.set(control,performance.now() + 410);
      });
    }
    window.addEventListener('keydown',(event)=>{
      if (state.mode !== 'drive' || dialogOpen() || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.target instanceof HTMLButtonElement && (event.key === ' ' || event.key === 'Enter')) return;
      const key = event.key.toLowerCase();
      if (key === 'enter' && !event.repeat) {
        trackInteract();
        return;
      }
      if (key === 'm' && !event.repeat) {
        setView(!state.overview);
        return;
      }
      const control = keyToControl.get(key);
      if (!control) return;
      event.preventDefault();
      if (event.repeat) return;
      if (state.assisted) setAssisted(false);
      keys.add(control);
    });
    window.addEventListener('keyup',(event)=> keys.delete(keyToControl.get(event.key.toLowerCase())));
    window.addEventListener('blur',clearControls);
    document.addEventListener('visibilitychange',()=>{ if(document.hidden) clearControls(); });
  }

  $('start-race').addEventListener('click',startRace);
  $('overview').addEventListener('click',()=>setView(!state.overview));
  $('assist').addEventListener('click',()=>{
    if (finishReached) return;
    setAssisted(!state.assisted);
    if(state.assisted) $('assist').blur();
    updateHUD();
  });
  $('recover').addEventListener('click',()=>{
    setAssisted(false);
    placeOnTrack(track.nearest(state.x,state.z).fraction);
    updateHUD();
  });
  $('interact').addEventListener('click',trackInteract);
  $('album-button').addEventListener('click',showAlbum);
  $('close-album').addEventListener('click',()=>album.close());
  $('home').addEventListener('click',goHome);
  $('story-mode').addEventListener('click',()=>{
    playMusic();
    showStoryStep();
  });
  $('close-memory').addEventListener('click',()=>photoDialog.close());
  $('continue-race').addEventListener('click',()=>{
    const shouldAdvance = photoOrigin === 'story';
    photoDialog.close();
    if(shouldAdvance) showStoryStep();
  });
  $('previous-photo').addEventListener('click',()=>showPhoto(openPhotoIndex-1));
  $('next-photo').addEventListener('click',()=>showPhoto(openPhotoIndex+1));
  photoDialog.addEventListener('keydown',(event)=>{
    if(event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    showPhoto(openPhotoIndex + (event.key === 'ArrowRight' ? 1 : -1));
  });
  photoDialog.addEventListener('close',() => {
    if(photoDialog.open) return;
    if (photoOrigin === 'track') document.activeElement?.blur?.();
    updateHUD();
  });
  $('close-finish').addEventListener('click',()=>$('finish').close());
  $('finish-album').addEventListener('click',()=>{
    $('finish').close();
    showAlbum();
  });
  $('replay').addEventListener('click',()=>{
    $('finish').close();
    resetRace();
    if(storyMode) $('story-mode').focus();
    else startRace();
  });

  placeOnTrack(.982);
  createAlbum();
  drawMapBase();
  createControls();
  musicControls();
  if(world) requestAnimationFrame(animate);
})();
