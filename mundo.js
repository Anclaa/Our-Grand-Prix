'use strict';

(() => {
  const T = window.THREE;
  const ROAD_WIDTH = 8.4;
  const WAYPOINTS = [
    [-11, 39], [11, 39], [32, 36], [45, 25], [47, 10], [39, -4], [22, -11],
    [26, -23], [22, -36], [6, -42], [-16, -39], [-29, -25], [-43, -20],
    [-49, -7], [-47, 11], [-39, 28], [-24, 38],
  ];
  const STATION_FRACTIONS = [.132, .293, .464, .645, .826];
  const STATIONS = [
    { name: 'Disfraces', tint: '#ff9b83', position: [36, 47] },
    { name: 'Medallas', tint: '#99b6ff', position: [49, -11] },
    { name: 'Jardín', tint: '#a4d5ad', position: [32, -43] },
    { name: 'Cuento', tint: '#ffc995', position: [-20, -50] },
    { name: 'Corazón', tint: '#ff8daa', position: [-57, 13] },
  ];
  const LABELS = {
    cream: '#fff1d6',
    navy: '#302540',
    rose: '#e0767f',
    peach: '#f4ac8e',
  };
  const v = (x, y, z) => new T.Vector3(x, y, z);
  const mix = (a, b, t) => a + (b - a) * t;

  function trackModel() {
    const spline = new T.CatmullRomCurve3(WAYPOINTS.map(([x, z]) => v(x, 0, z)), true, 'catmullrom', .46);
    spline.arcLengthDivisions = 840;
    const length = spline.getLength();
    const samples = Array.from({ length: 420 }, (_, index) => spline.getPointAt(index / 420));
    const stations = STATION_FRACTIONS.map((fraction, index) => ({
      ...STATIONS[index], fraction, point: spline.getPointAt(fraction),
    }));
    function nearest(x, z) {
      let best = Infinity;
      let chosen = 0;
      for (let index = 0; index < samples.length; index += 1) {
        const point = samples[index];
        const distance = (point.x - x) ** 2 + (point.z - z) ** 2;
        if (distance < best) {
          best = distance;
          chosen = index;
        }
      }
      return { distance: Math.sqrt(best), fraction: chosen / samples.length };
    }
    return { spline, samples, stations, nearest, length };
  }

  function rng(seed) {
    let state = seed;
    return () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function canvasTexture(width, height, paint) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    paint(canvas.getContext('2d'), width, height);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }

  function create(container, model) {
    const surface = document.createElement('canvas');
    const attributes = { alpha: true, antialias: true };
    const context = surface.getContext('webgl2', attributes) || surface.getContext('webgl', attributes);
    let renderer;
    try {
      if (context) renderer = new T.WebGLRenderer({ canvas: surface, context, ...attributes });
    } catch (error) {
      console.info('Se usará el renderizado alternativo.', error.message);
    }
    if (renderer) {
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      renderer.shadowMap.autoUpdate = false;
      container.append(renderer.domElement);
    } else {
      renderer = window.grandPrixCanvas.create(container);
    }

    const scene = new T.Scene();
    const world = new T.Group();
    scene.add(world);
    scene.add(new T.HemisphereLight('#e0c1ff', '#5d436a', 1.47));
    const key = new T.DirectionalLight('#ffdcc1', 2);
    key.position.set(-32, 67, 28);
    key.castShadow = true;
    key.shadow.mapSize.set(1536, 1536);
    key.shadow.camera.left = -81;
    key.shadow.camera.right = 81;
    key.shadow.camera.top = 72;
    key.shadow.camera.bottom = -72;
    key.shadow.camera.near = 8;
    key.shadow.camera.far = 160;
    key.shadow.normalBias = .055;
    key.shadow.bias = -.0001;
    scene.add(key);
    const rim = new T.DirectionalLight('#849dff', 1.25);
    rim.position.set(48, 21, -63);
    scene.add(rim);

    const materials = new Map();
    const photoLoader = new T.TextureLoader();
    const contactShade = new T.MeshBasicMaterial({ color:'#2a2038',transparent:true,opacity:.26,depthWrite:false });
    const boxGeometry = new T.BoxGeometry(1, 1, 1);
    const cylinderGeometry = new T.CylinderGeometry(1, 1, 1, 12);
    const coneGeometry = new T.ConeGeometry(1, 1, 7);
    const sphereGeometry = new T.IcosahedronGeometry(1, renderer.isSoftware ? 0 : 1);
    const ringGeometry = new T.TorusGeometry(1, .105, 6, 36);
    let car;
    const marquees = [];
    const startBulbs = [];
    const colliders = [];

    function material(color, emissive = false) {
      const key = color + (emissive ? ' glow' : '');
      if (!materials.has(key)) {
        materials.set(key, emissive ? new T.MeshBasicMaterial({ color }) : new T.MeshStandardMaterial({ color, roughness: .83 }));
      }
      return materials.get(key);
    }

    function shape(group, geo, mat, x, y, z, sx, sy, sz, cast = true) {
      const mesh = new T.Mesh(geo, typeof mat === 'string' ? material(mat) : mat);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(x, y, z);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    }

    function block(group, mat, x, y, z, sx, sy, sz, cast = true) {
      return shape(group, boxGeometry, mat, x, y, z, sx, sy, sz, cast);
    }

    function tube(group, mat, a, b, radius, cast = true) {
      const center = a.clone().add(b).multiplyScalar(.5);
      const mesh = shape(group, cylinderGeometry, mat, center.x, center.y, center.z, radius, a.distanceTo(b), radius, cast);
      mesh.quaternion.setFromUnitVectors(v(0, 1, 0), b.clone().sub(a).normalize());
      return mesh;
    }

    function bulb(group, color, x, y, z, radius = .15) {
      return shape(group, sphereGeometry, material(color, true), x, y, z, radius, radius, radius, false);
    }

    function platformContour(scale = 1) {
      const outline = new T.Shape();
      for (let index = 0; index <= 84; index += 1) {
        const angle = index / 84 * Math.PI * 2;
        const taper = 1 + .031 * Math.sin(angle * 3 - .9) + .019 * Math.cos(angle * 7);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const x = Math.sign(cos) * Math.abs(cos) ** .63 * 63.3 * taper * scale;
        const z = Math.sign(sin) * Math.abs(sin) ** .65 * 54.2 * taper * scale;
        if (index === 0) outline.moveTo(x, -z);
        else outline.lineTo(x, -z);
      }
      return outline;
    }

    function platter() {
      const speckles = canvasTexture(192, 192, (ctx, width, height) => {
        const random = rng(24);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        for (let index = 0; index < 3600; index += 1) {
          ctx.fillStyle = index % 4 ? '#b6a8cf22' : '#55476a34';
          ctx.fillRect(random() * width, random() * height, 1 + random(), 1 + random());
        }
      });
      speckles.wrapS = speckles.wrapT = T.RepeatWrapping;
      speckles.repeat.set(.105, .105);
      const layers = [
        { y: -5.2, scale: 1.01, depth: 1.9, top: '#51466e', side: '#342744' },
        { y: -3.5, scale: 1.018, depth: .44, top: '#b78291', side: '#a16b82' },
        { y: -3.1, scale: 1, depth: 3.02, top: '#625574', side: '#4a3b5f' },
      ];
      for (const [index, layer] of layers.entries()) {
        const geo = new T.ExtrudeGeometry(platformContour(layer.scale), { depth: layer.depth, bevelEnabled: true, bevelSize: .62, bevelThickness: .52, bevelSegments: 2, steps: 1 });
        const top = new T.MeshStandardMaterial({ color: layer.top, map: speckles, roughness: 1 });
        const ground = new T.Mesh(geo, [top, material(layer.side)]);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = layer.y - .51;
        ground.receiveShadow = true;
        ground.userData.layer = -40 + index;
        world.add(ground);
      }
      const shadowTexture = canvasTexture(192, 192, (ctx, width, height) => {
        const gradient = ctx.createRadialGradient(width / 2, height / 2, 20, width / 2, height / 2, 95);
        gradient.addColorStop(0, '#0908179c');
        gradient.addColorStop(.60, '#0d0a1a64');
        gradient.addColorStop(1, '#0b091700');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      });
      const shadow = new T.Mesh(new T.PlaneGeometry(181, 142), new T.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(9, -6.6, 7);
      shadow.userData.layer = -42;
      world.add(shadow);
    }

    function ribbon(width, y, mat, offset = 0) {
      const vertices = [];
      const indices = [];
      const count = model.samples.length;
      model.samples.forEach((point, index) => {
        const next = model.samples[(index + 1) % count];
        const previous = model.samples[(index + count - 1) % count];
        const tx = next.x - previous.x;
        const tz = next.z - previous.z;
        const norm = Math.hypot(tx, tz);
        for (const edge of [-width / 2 + offset, width / 2 + offset]) vertices.push(point.x - tz / norm * edge, y, point.z + tx / norm * edge);
        const a = index * 2;
        const b = ((index + 1) % count) * 2;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      });
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const trackMat = material(mat).clone();
      trackMat.side = T.DoubleSide;
      const mesh = new T.Mesh(geometry, trackMat);
      mesh.receiveShadow = true;
      mesh.userData.layer = -19 + Math.round((y - .045) * 1000) / 10;
      const outer = [];
      const inner = [];
      for (let i = 0; i < vertices.length; i += 6) {
        outer.push(v(vertices[i],vertices[i+1],vertices[i+2]));
        inner.push(v(vertices[i+3],vertices[i+4],vertices[i+5]));
      }
      mesh.userData.outline=outer.concat([outer[0]],inner.reverse(),[inner[0]]);
      world.add(mesh);
    }

    function groundSlats(count, dimensions, position, colors) {
      const slats = new T.InstancedMesh(boxGeometry, new T.MeshStandardMaterial({ color: '#ffffff', roughness: .9 }), count);
      const dummy = new T.Object3D();
      const color = new T.Color();
      for (let index = 0; index < count; index += 1) {
        const { x, y, z, angle } = position(index);
        dummy.position.set(x, y, z);
        dummy.scale.set(...dimensions);
        dummy.rotation.y = angle;
        dummy.updateMatrix();
        slats.setMatrixAt(index, dummy.matrix);
        slats.setColorAt(index, color.set(colors[index % colors.length]));
      }
      slats.receiveShadow = true;
      slats.userData.layer = -13;
      world.add(slats);
    }

    function asphalt() {
      ribbon(ROAD_WIDTH + 1.3, .045, '#49374d');
      ribbon(ROAD_WIDTH + .07, .055, '#322a3e');
      ribbon(.13, .067, '#c6b1c2', ROAD_WIDTH / 2 - .3);
      ribbon(.13, .067, '#c6b1c2', -ROAD_WIDTH / 2 + .3);
      const coursePose = (index, total, offset) => {
        const part = index / total;
        const point = model.spline.getPointAt(part);
        const tangent = model.spline.getTangentAt(part);
        return { x: point.x - tangent.z * offset, y: .075, z: point.z + tangent.x * offset, angle: Math.atan2(-tangent.z, tangent.x) };
      };
      for (const side of [-1, 1]) {
        groundSlats(176, [1.02, .035, .42], (index) => coursePose(index, 176, side * (ROAD_WIDTH / 2 + .11)), side === 1 ? ['#ed9c9a','#ead2c8'] : ['#8583b0','#cdd3ed']);
      }
      groundSlats(80, [1.41, .03, .12], (index) => coursePose(index, 80, 0), ['#8e7d95']);
    }

    function groundPatch(x, z, radius, color, elevation = .016, verticalScale = .66) {
      const mesh = new T.Mesh(new T.CircleGeometry(radius, 22), material(color));
      mesh.rotation.x = -Math.PI / 2;
      mesh.scale.y = verticalScale;
      mesh.position.set(x, elevation, z);
      mesh.receiveShadow = true;
      mesh.userData.layer = -32 + Math.round(elevation*1000)/10;
      world.add(mesh);
      return mesh;
    }

    function contactShadow(group,x,z,radius,scale=.65) {
      if (!renderer.isSoftware) return;
      const shadow = new T.Mesh(new T.CircleGeometry(radius,14),contactShade);
      shadow.rotation.x=-Math.PI/2;
      shadow.scale.y=scale;
      shadow.position.set(x+.45,.028,z-.33);
      shadow.userData.layer=-27;
      group.add(shadow);
    }

    function sign(group, text, x, y, z, width, height, color = LABELS.navy, foreground = LABELS.cream) {
      const tex = canvasTexture(512, 128, (ctx, w, h) => {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = foreground + '88';
        ctx.lineWidth = 4;
        ctx.strokeRect(10, 10, w - 20, h - 20);
        ctx.font = '900 italic 61px "Arial Narrow", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = foreground;
        ctx.fillText(text, w / 2, h / 2 + 4, w - 40);
      });
      block(group, color, x, y, z, width + .17, height + .17, .22);
      const panel = new T.Mesh(new T.PlaneGeometry(width, height), new T.MeshBasicMaterial({ map: tex }));
      panel.position.set(x, y, z + .126);
      group.add(panel);
      return panel;
    }

    function tire(group, x, z, y = .64, radius = .54) {
      const wheel = shape(group, cylinderGeometry, '#291f2e', x, y, z, radius, .43, radius);
      wheel.rotation.z = Math.PI / 2;
      shape(group, cylinderGeometry, '#b28c9f', x + Math.sign(x) * .228, y, z, .26, .037, .26).rotation.z = Math.PI / 2;
      shape(group, cylinderGeometry, '#423146', x + Math.sign(x) * .251, y, z, .13, .015, .13).rotation.z = Math.PI / 2;
    }

    function makeCar() {
      car = new T.Group();
      world.add(car);
      const midnight = '#253664';
      const violet = '#4c5b9c';
      const coral = '#f46f67';
      block(car, '#382840', 0, .42, 0, 1.82, .23, 3.12);
      block(car, midnight, 0, .66, -.15, .94, .42, 2.49);
      block(car, violet, -.62, .64, -.15, .44, .30, 1.31).rotation.y = -.09;
      block(car, violet, .62, .64, -.15, .44, .30, 1.31).rotation.y = .09;
      block(car, coral, -.80, .69, -.08, .12, .25, 1.12);
      block(car, coral, .80, .69, -.08, .12, .25, 1.12);
      block(car, midnight, 0, .61, 1.10, .6, .29, 1.35).rotation.x = .14;
      block(car, '#ed926e', 0, .54, 1.57, .29, .15, .37).rotation.x = .15;
      block(car, '#333b64', 0, .43, 1.61, 2.37, .14, .44);
      block(car, coral, 0, .49, 1.73, 2.14, .07, .13);
      block(car, midnight, 0, .91, -1.39, .22, .41, .25);
      block(car, '#424670', 0, 1.115, -1.43, 2.02, .15, .41);
      block(car, coral, 0, 1.20, -1.49, 1.91, .055, .085);
      for (const side of [-1, 1]) {
        block(car, coral, side * .96, 1.11, -1.43, .11, .27, .47);
        block(car, midnight, side * 1.10, .49, 1.63, .11, .24, .46);
        tire(car, side * 1.03, 1.02);
        tire(car, side * 1.04, -1.03, .62, .58);
      }
      shape(car, sphereGeometry, '#1e273b', 0, .94, -.10, .38, .17, .50);
      shape(car, sphereGeometry, '#ffd382', 0, 1.03, -.07, .27, .26, .29);
      block(car, '#6a526b', 0, 1.075, .11, .42, .10, .12);
      bulb(car, '#ff646b', 0, .64, -1.75, .12);
      const racingNumber = canvasTexture(128, 128, (ctx, width, height) => {
        ctx.fillStyle = '#f9e1b9';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#4e3044';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'italic 900 84px Arial';
        ctx.fillText('33', width / 2 - 3, height / 2 + 3);
      });
      const icon = new T.Mesh(new T.PlaneGeometry(.41, .46), new T.MeshBasicMaterial({ map: racingNumber }));
      icon.rotation.x = -Math.PI / 2;
      icon.position.set(0, .770, .94);
      car.add(icon);
      const glow = canvasTexture(64, 64, (ctx, w, h) => {
        const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        gradient.addColorStop(0, '#07091a9c');
        gradient.addColorStop(1, '#07091a00');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
      });
      const contact = new T.Mesh(new T.PlaneGeometry(4.55, 5.4), new T.MeshBasicMaterial({ map: glow, transparent: true, depthWrite: false }));
      contact.rotation.x = -Math.PI / 2;
      contact.position.y = .128;
      contact.userData.layer=-8;
      car.add(contact);
    }

    function makeStart() {
      const gate = new T.Group();
      const start = model.spline.getPointAt(0);
      const tangent = model.spline.getTangentAt(0);
      gate.position.set(start.x, 0, start.z);
      gate.rotation.y = Math.atan2(tangent.x, tangent.z) + Math.PI;
      world.add(gate);
      for (const side of [-1, 1]) {
        block(gate, LABELS.navy, side * 5.28, 2.4, 0, .55, 4.8, .72);
        block(gate, LABELS.rose, side * 5.28, .29, 0, 1.46, .58, 1.77);
        block(gate, LABELS.peach, side * 5.28, 2.48, .4, .14, 3.38, .055);
        bulb(gate, '#ffd7a7', side * 5.28, 4.84, 0, .28);
      }
      const plate = sign(gate, 'OUR GRAND PRIX', 0, 4.72, 0, 10.9, 1.27, '#3a2a4b', '#ffe0b8');
      const back = plate.clone();
      back.rotation.y = Math.PI;
      back.position.z *= -1;
      gate.add(back);
      block(gate, '#211e31', 0, 3.65, .07, 3.24, .63, .55);
      for (let index = 0; index < 5; index += 1) {
        startBulbs.push(bulb(gate, '#573543', (index - 2) * .61, 3.65, .41, .20));
        startBulbs[index].material = material('#573543', true).clone();
      }
      for (let col = 0; col < 12; col += 1) {
        for (let row = 0; row < 2; row += 1) {
          block(gate, (row + col) % 2 ? '#fff2cf' : '#37314b', (col - 5.5) * .63, .081, row * .63 - .24, .64, .022, .64, false);
        }
      }
    }

    function tree(group, x, z, height, shade, style = 0) {
      contactShadow(group,x,z,height*.42);
      const trunk = shape(group, cylinderGeometry, '#6e4856', x, height * .25, z, height * .064, height * .5, height * .064);
      trunk.rotation.z = -.08;
      if (style === 1) {
        for (let level = 0; level < 3; level += 1) {
          const width = height * (.34 - level * .064);
          shape(group, coneGeometry, level === 1 ? '#668478' : shade, x + level * .07, height * (.48 + .17 * level), z, width, height * .55, width);
        }
      } else {
        shape(group, sphereGeometry, shade, x, height * .69, z, height * .31, height * .33, height * .29);
        shape(group, sphereGeometry, shade, x + height * .17, height * .58, z + height * .05, height * .22, height * .245, height * .20);
        shape(group, sphereGeometry, '#a38eab', x - height * .12, height * .73, z + height * .08, height * .135, height * .17, height * .13);
      }
    }

    function sticks(group, x, z, angle, color) {
      const light = new T.Group();
      light.position.set(x, 0, z);
      light.rotation.y = angle;
      group.add(light);
      block(light, '#57445c', 0, .16, 0, .75, .32, .66);
      block(light, '#ae889a', 0, 1.55, 0, .14, 3.15, .14);
      block(light, '#705779', .23, 3.11, 0, .67, .15, .32);
      bulb(light, color, .42, 2.98, 0, .15);
    }

    function bunting(group, a, b, colorList) {
      const segments = 14;
      let previous = a;
      for (let index = 1; index <= segments; index += 1) {
        const t = index / segments;
        const point = a.clone().lerp(b, t);
        point.y -= Math.sin(t * Math.PI) * .63;
        tube(group, '#8f697f', previous, point, .024, false);
        if (index % 2 === 1) {
          bulb(group, colorList[index % colorList.length], point.x, point.y - .09, point.z, .14);
        }
        previous = point;
      }
    }

    function makeDisguises(group) {
      const shades = ['#ffd4a5','#ef9e9f','#a7a7ef'];
      for (const x of [-4.2, 4.2]) {
        block(group, '#945870', x, 1.99, -.8, .55, 3.98, .69);
        block(group, LABELS.peach, x, 2.18, -.38, .23, 3.47, .20);
      }
      for (let index = 0; index < 7; index += 1) {
        const color = shades[index % shades.length];
        const x = -3.86 + index * 1.29;
        shape(group, coneGeometry, color, x, 4.2, -.80, 1.13, 1.44, 1.24).rotation.y = Math.PI / 4;
        bulb(group, '#ffe3a9', x, 3.65, .10, .137);
      }
      block(group, '#ab6b7e', 0, .22, -.15, 8.5, .44, 4.2);
      block(group, '#e99789', 0, .43, -.15, 8.3, .10, 4.06);
      bunting(group, v(-4.1,3.6,2), v(4.1,3.67,2), shades);
      for (const [x, z] of [[-5.5,1.3],[4.8,1.8],[5.4,-1.6]]) {
        tube(group, '#ae9ac3', v(x,.3,z), v(x,2.22,z), .035, false);
        shape(group, sphereGeometry, shades[Math.abs(Math.round(x)) % 3], x, 2.61, z, .54, .66, .53);
      }
    }

    function makePodium(group) {
      const colors = ['#7398c1', '#e7a478', '#af8fb0'];
      [1.15, 1.95, .80].forEach((height, index) => {
        const x = (index - 1) * 2.22;
        block(group, colors[index], x, height / 2, 0, 2, height, 2.7);
        sign(group, String([2, 1, 3][index]), x, height * .53, 1.36, 1.07, .52, '#3e365d');
      });
      for (let index = 0; index < 7; index += 1) {
        block(group, index % 2 ? '#d99f9d' : '#fff0c3', -3.2 + index, .045, 3.2, .88, .046, .33, false);
      }
      for (const side of [-1, 1]) {
        tube(group, '#9c7c9e', v(4.28 * side,0,-1.3), v(4.28 * side,4.65,-1.3), .088);
        const flag = block(group, side < 0 ? '#ef9ea0' : '#a5b9f0', 4.28 * side + side * .73, 4.12, -1.3, 1.46, .92, .065);
        flag.rotation.y = .25;
      }
    }

    function makeGarden(group) {
      const pond = shape(group, cylinderGeometry, '#688785', 0, .20, .25, 4.45, .4, 2.72);
      pond.rotation.y = -.15;
      shape(group, cylinderGeometry, '#517c91', 0, .44, .25, 4.19, .09, 2.49);
      const bridge = new T.Group();
      bridge.rotation.y = -.52;
      group.add(bridge);
      for (let index = -6; index <= 6; index += 1) {
        block(bridge, index % 2 ? '#c18a84' : '#ad777d', index * .49, .74 + Math.cos(index / 6 * Math.PI / 2) * .57, 0, .5, .19, 1.6);
      }
      for (const side of [-1, 1]) {
        for (const x of [-3.2,-1.56,0,1.56,3.2]) {
          block(bridge, '#9a565f', x, 1.02 + .53 * Math.cos(x / 3.2 * Math.PI / 2), side * .82, .14, .99, .14);
        }
        for (let i = 0; i < 10; i += 1) {
          const x = -3.2 + i * .64;
          tube(bridge, '#ce8585', v(x,1.53 + .54*Math.cos(x/3.2*Math.PI/2),side*.82), v(x+.64,1.53 + .54*Math.cos((x+.64)/3.2*Math.PI/2),side*.82), .065);
        }
      }
      for (const [x,z,height] of [[-3.6,-2.5,3.2],[2.6,-2.5,5.1],[4.4,1,2.7],[-5,2,2.1]]) {
        shape(group, cylinderGeometry, '#b38e9e', x, .25, z, height * .29, .5, height * .25);
        tree(group,x,z,height,'#a4b8a4');
      }
      for (const [x,z] of [[-4.1,2.8],[4.05,-1.8]]) {
        block(group, '#977f95', x, .71, z, .38, 1.42, .42);
        block(group, material('#ffd0a4', true), x, 1.47, z, .57, .5, .57, false);
        shape(group, coneGeometry, '#906375', x, 1.87, z, .55, .36, .55);
      }
    }

    function makeCastle(group) {
      const stone = '#9e7891';
      block(group, '#a27a8c', 0, .15, 0, 10.3, .31, 6.8);
      block(group, stone, 0, 2.1, -.65, 6.3, 4.2, 4.25);
      block(group, '#4e3857', 0, 1.06, 1.54, 1.28, 2.08, .09);
      for (const side of [-1, 1]) {
        const x = side * 3.57;
        shape(group,cylinderGeometry,side === -1 ? stone : '#906985',x,2.68,.55,1.21,5.36,1.21);
        shape(group,coneGeometry,side === -1 ? '#bd7385' : '#b36282',x,6.05,.55,1.60,2.23,1.60);
        bulb(group,'#ffd6a6',x,7.26,.55,.20);
        block(group,material('#ffc98a',true),x,3.43,1.7,.25,.83,.095,false);
        block(group,material('#ffc98a',true),side*1.85,2.89,1.51,.37,.74,.10,false);
        block(group,'#c19ba6',side*1.14,.37,2.13,.46,.7,.45);
      }
      for(let index=0;index<7;index += 1) block(group,'#bd9aa9',-2.8 + .94*index,4.34,1.42,.56,.54,.68);
      block(group,'#957a91',0,.12,2.78,1.6,.24,1.42);
      for (const x of [-2.2,2.2]) sticks(group,x,3.2,.7,'#ffc78c');
    }

    function makeHeart(group) {
      const arch = new T.Group();
      group.add(arch);
      arch.rotation.y = -.59;
      const points = [];
      for (let index = 0; index <= 84; index += 1) {
        const angle = index / 84 * Math.PI * 2;
        const x = 16 * Math.sin(angle) ** 3;
        const y = 13 * Math.cos(angle) - 5 * Math.cos(2 * angle) - 2 * Math.cos(3 * angle) - Math.cos(4 * angle);
        points.push(v(x * .275, y * .251 + 4.94, 0));
      }
      const curve = new T.CatmullRomCurve3(points.slice(0, -1), true);
      const edges = new T.TubeGeometry(curve, 94, .205, 8, true);
      const neon = new T.TubeGeometry(curve, 94, .082, 7, true);
      const frame = new T.Mesh(edges, material('#d4537f'));
      frame.castShadow = true;
      arch.add(frame);
      const glow = new T.Mesh(neon, material('#ffb5ba', true));
      glow.position.z = .185;
      arch.add(glow);
      const haloTexture = canvasTexture(128, 128, (ctx, width, height) => {
        const grad = ctx.createRadialGradient(width/2,height/2,4,width/2,height/2,width/2);
        grad.addColorStop(0,'#f784ba66');
        grad.addColorStop(.47,'#f887be24');
        grad.addColorStop(1,'#f687b900');
        ctx.fillStyle = grad;
        ctx.fillRect(0,0,width,height);
      });
      const halo = new T.Mesh(new T.PlaneGeometry(14.3,13),new T.MeshBasicMaterial({map:haloTexture,transparent:true,depthWrite:false,side:T.DoubleSide}));
      halo.position.set(0,4.45,-.45);
      arch.add(halo);
      block(group,'#ae647e',0,.2,.05,7.8,.4,3.65);
      block(group,'#e9a5a4',0,.42,.05,7.38,.11,3.25);
      block(group,'#b3758b',0,.98,.45,3.30,.35,1.13);
      for(const x of [-2.45,2.45]){
        block(group,'#ca8291',x,1.02,1.1,.39,1.8,.54);
        bulb(group,'#ffe2b3',x,2.01,1.1,.19);
      }
    }

    function makeStations() {
      const makers = [makeDisguises, makePodium, makeGarden, makeCastle, makeHeart];
      model.stations.forEach((station, index) => {
        const [x, z] = station.position;
        const center = model.spline.getPointAt(station.fraction);
        const buildings = new T.Group();
        buildings.position.set(x, 0, z);
        buildings.rotation.y = Math.atan2(center.x - x, center.z - z);
        world.add(buildings);
        contactShadow(buildings,0,0,5.1,.62);
        makers[index](buildings);
        colliders.push({ x, z, radius: index === 3 ? 4.3 : 3.45 });
        const marker = new T.Group();
        marker.position.set(center.x, .10, center.z);
        world.add(marker);
        shape(marker, cylinderGeometry, '#6d465e', 0, .017, 0, 2.53, .024, 2.53, false);
        const ring = shape(marker, ringGeometry, material(station.tint, true), 0, .07, 0, 2.20, 2.20, .65, false);
        ring.rotation.x = -Math.PI / 2;
        const badge = canvasTexture(192, 96, (ctx, w, h) => {
          ctx.fillStyle = '#34243c';
          ctx.fillRect(3, 8, w-6, h-16);
          ctx.strokeStyle = station.tint;
          ctx.lineWidth = 4;
          ctx.strokeRect(5,10,w-10,h-20);
          ctx.fillStyle = station.tint;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = 'bold 28px Arial';
          ctx.fillText('♥  ' + station.name, w / 2, h / 2 + 3, w-16);
        });
        const label = new T.Sprite(new T.SpriteMaterial({ map: badge, transparent: true, depthWrite: false }));
        label.position.copy(center).add(v(0,3.68,0));
        label.scale.set(7.55,3.77,1);
        world.add(label);
        const albumStand = new T.Group();
        albumStand.position.set(3.7,0,3.25);
        buildings.add(albumStand);
        block(albumStand,'#916d87',0,1.12,0,.14,2.25,.18);
        block(albumStand,'#e0b49e',0,2.18,.06,2.13,1.74,.25);
        const setting = sign(albumStand,'♥',0,2.20,.22,1.83,1.36,'#5d405f',station.tint);
        const picture = new T.Mesh(new T.PlaneGeometry(1.69,1.29),new T.MeshBasicMaterial({color:'#fff7ed'}));
        picture.position.set(0,2.21,.362);
        picture.rotation.z=-.068;
        picture.visible=false;
        albumStand.add(picture);
        marquees.push({ label, ring, tint: station.tint, picture, setting });
        const post = new T.Group();
        post.position.copy(center).lerp(buildings.position, .51);
        post.rotation.y = buildings.rotation.y;
        world.add(post);
        block(post,'#63516e',-.83,1.02,0,.12,2.04,.15);
        block(post,'#63516e',.83,1.02,0,.12,2.04,.15);
        sign(post,String(index+1).padStart(2,'0') + '  /  ' + station.name.toUpperCase(),0,2.01,0,2.81,.63,'#523950',station.tint);
      });
    }

    function landscape() {
      const random = rng(64);
      const shrubs = ['#9281a5','#aa7f9b','#857d9e','#798b9b','#647d83','#9a87a8'];
      const count = 88;
      for(let index=0;index<count;index += 1){
        const x = (random() - .5) * 116;
        const z = (random() - .5) * 99;
        const nearStation = model.stations.some((station) => Math.hypot(station.position[0]-x,station.position[1]-z) < 9);
        const onPlatter = (Math.abs(x)/60)**3.2+(Math.abs(z)/50)**3.05 < .86;
        if(!onPlatter || model.nearest(x,z).distance < 6.3 || nearStation) continue;
        const size = 1.65 + random()*3.75;
        const shade = shrubs[Math.floor(random()*shrubs.length)];
        tree(world,x,z,size,shade,index % 4 === 0 ? 1 : 0);
        if (size > 3.55) colliders.push({ x, z, radius: size * .17 });
        if(index % 2 === 0) groundPatch(x,z,1.7+random()*2.4,'#726087',.017,.78);
      }
      groundPatch(-13,-2,13.5,'#74617f',.018,.7);
      groundPatch(-11,-3,9.8,'#685777',.022,.75);
      contactShadow(world,-8,-4,6.7,.64);
      const rest = new T.Group();
      rest.position.set(-9,0,-4);
      rest.rotation.y = .29;
      world.add(rest);
      for(const x of [-5.5,5.5]){
        block(rest,'#856880',x,2.30,-1.6,.23,4.6,.25);
        block(rest,'#856880',x,2.30,1.6,.23,4.6,.25);
        block(rest,'#a3899c',x,4.58,0,.28,.22,3.6);
      }
      for(let index=0;index<8;index+=1){
        block(rest,'#a77d91',0,4.64,-1.6+index*.46,11.4,.13,.18);
      }
      for(const z of [-1.45,1.45]) bunting(rest,v(-5.4,4.28,z),v(5.4,4.28,z),['#ffd2a8','#ed97a7','#b8a7ed']);
      block(rest,'#a88293',0,.20,0,10.9,.39,3.61);
      block(rest,'#674d68',0,.72,0,6.8,.24,.62);
      sign(rest,'TÚ & YO',0,2.6,0,4.9,.93,'#3f304f','#ffd7a7');
      for(let index=0;index<18;index+=1){
        const t=(index+.6)/18;
        const point=model.spline.getPointAt(t);
        const tangent=model.spline.getTangentAt(t);
        const side=index%3===0 ? -1:1;
        const x=point.x-tangent.z*side*6.05;
        const z=point.z+tangent.x*side*6.05;
        const conflict=model.stations.some(({point:p})=>Math.hypot(p.x-x,p.z-z)<6.8);
        if(!conflict) sticks(world,x,z,Math.atan2(tangent.x,tangent.z) + Math.PI * (side > 0 ? 1 : 0),index%2?'#ffd1a0':'#c5bcff');
      }
    }

    function stars() {
      const random = rng(102);
      const positions = [];
      const colors = [];
      const coral = new T.Color('#dfa2b8');
      const blue = new T.Color('#bbb8ed');
      for (let n = 0; n < 320; n += 1) {
        positions.push((random() - .5) * 410, random() * 34 - 35, (random() - .5) * 345);
        const color = n % 3 === 0 ? coral : blue;
        const shade = .3 + random() * .52;
        colors.push(color.r * shade, color.g * shade, color.b * shade);
      }
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute(positions,3));
      geometry.setAttribute('color', new T.Float32BufferAttribute(colors,3));
      const starField = new T.Points(geometry,new T.PointsMaterial({size:.23,vertexColors:true,transparent:true,opacity:.75,depthWrite:false}));
      scene.add(starField);
    }

    platter();
    asphalt();
    landscape();
    makeStations();
    makeStart();
    makeCar();
    stars();

    const camera = new T.OrthographicCamera(-75,75,50,-50,.1,520);
    const target = v(0,0,0);
    const currentTarget = v(0,0,0);
    const wantedPosition = v(91,105,133);
    const currentPosition = wantedPosition.clone();
    let scale = 61;
    let panX = 0;
    let panY = 0;
    let width = 0;
    let height = 0;
    let previousPose = { x: Infinity, z: Infinity, heading: Infinity };
    let previousLights = -1;
    let previousSeen = -1;

    function resize() {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      if(newWidth === width && newHeight === height) return;
      width = Math.max(newWidth,1);
      height = Math.max(newHeight,1);
      renderer.setSize(width,height,false);
    }

    function render(state, dt, now) {
      resize();
      const { x, z, heading, mode, overview, nearby, visited, lights, reducedMotion } = state;
      car.position.set(x,.073,z);
      car.rotation.y = heading;
      if (Math.hypot(x-previousPose.x,z-previousPose.z) > .25 || Math.abs(heading-previousPose.heading) > .2) {
        renderer.shadowMap.needsUpdate = true;
        previousPose = { x, z, heading };
      }
      if (lights !== previousLights) {
        startBulbs.forEach((lamp,index) => lamp.material.color.set(index < lights ? '#ff6a70' : '#573543'));
        previousLights = lights;
      }
      const intro = mode === 'intro';
      const panorama = intro || overview;
      const vertical = width < 721;
      const aspect = width / height;

      let desiredScale;
      let desiredPanX = 0;
      let desiredPanY = 0;
      if (panorama) {
        const angle = (reducedMotion ? 0 : Math.sin(now * .00018) * .070);
        target.set(0,0,0);
        wantedPosition.set(91 - angle * 115, 103, 124 + angle * 82);
        desiredScale = vertical ? Math.max(61, 65/aspect) : Math.max(55.8, 65 / aspect);
        if(intro) {
          desiredPanX = vertical ? 0 : -.176;
          desiredPanY = vertical ? .165 : .035;
          if (!vertical && aspect < 1.55) desiredScale *= 1.12;
        }
      } else {
        target.set(x + Math.sin(heading) * 4.8, 0, z + Math.cos(heading) * 4.8);
        const sideAngle = heading + .36;
        wantedPosition.set(x - Math.sin(sideAngle)*25, 29.5, z - Math.cos(sideAngle)*25);
        desiredScale = vertical ? 28 : 24;
        desiredPanX = vertical ? 0 : -.072;
        desiredPanY = vertical ? .075 : .023;
      }
      const alpha = reducedMotion ? 1 : 1 - Math.exp(-Math.max(dt,.001) * 4.7);
      currentTarget.lerp(target,alpha);
      currentPosition.lerp(wantedPosition,alpha);
      scale=mix(scale,desiredScale,alpha);
      panX=mix(panX,desiredPanX,alpha);
      panY=mix(panY,desiredPanY,alpha);
      camera.left=-scale*aspect;
      camera.right=scale*aspect;
      camera.top=scale;
      camera.bottom=-scale;
      camera.setViewOffset(width,height,width*panX,height*panY,width,height);
      camera.position.copy(currentPosition);
      camera.lookAt(currentTarget);
      camera.updateProjectionMatrix();
      marquees.forEach(({label,ring,tint,picture,setting},index) => {
        label.visible = !panorama && Math.hypot(model.stations[index].point.x-x,model.stations[index].point.z-z) < 31;
        label.position.y = 3.69 + (reducedMotion ? 0 : Math.sin(now * .002 + index) * .18);
        label.material.opacity = nearby === index ? 1 : .8;
        if(previousSeen !== visited) {
          const unlocked=Boolean(visited & (1 << index));
          ring.material = material(unlocked ? '#9eddad' : tint,true);
          if(unlocked && !picture.material.map && window.grandPrixCovers?.[index]) {
            const cover=photoLoader.load(window.grandPrixCovers[index]);
            cover.colorSpace=T.SRGBColorSpace;
            picture.material.map=cover;
            picture.material.needsUpdate=true;
          }
          picture.visible=Boolean(unlocked && picture.material.map);
          setting.visible=!picture.visible;
        }
      });
      previousSeen = visited;
      renderer.render(scene,camera);
    }

    function obstacleAt(x,z){
      return colliders.some((item) => Math.hypot(x-item.x,z-item.z) < item.radius + .75);
    }
    return { render, obstacleAt, isSoftware: Boolean(renderer.isSoftware) };
  }

  window.grandPrixWorld = { trackModel, create };
})();
