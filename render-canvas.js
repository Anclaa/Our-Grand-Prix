'use strict';

(() => {
  const T = window.THREE;
  const geometryCache = new WeakMap();
  const tile = new T.Matrix4();
  const ndc = new T.Matrix4();
  const unit = new T.Vector3();
  const key = new T.Vector3(-.39,.83,.33).normalize();
  const normals = new T.Matrix3();
  const blitCopy = new T.Color();

  function facesOf(geometry) {
    if (geometryCache.has(geometry)) return geometryCache.get(geometry);
    const { position, uv } = geometry.attributes;
    const indices = geometry.index?.array;
    const count = indices?.length ?? position.count;
    const points = (ids) => ids.map((id) => new T.Vector3().fromBufferAttribute(position,id));
    const makeFace = (ids, material = 0) => {
      const vertices = points(ids);
      const [a,b,c] = vertices;
      const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      return { vertices, normal, material };
    };

    let faces;
    if (geometry.type === 'BoxGeometry') {
      faces = Array.from({length:6},(_,index)=> {
        const i = index * 4;
        return makeFace([i,i+2,i+3,i+1],index);
      });
    } else if (geometry.type === 'PlaneGeometry') {
      faces = [makeFace([0,2,3,1])];
      faces[0].imageQuad = Boolean(uv);
    } else {
      faces = [];
      let material = 0;
      for(let start=0;start<count;start+=3){
        if(geometry.groups.length) {
          const group = geometry.groups.find((item) => start >= item.start && start < item.start + item.count);
          if(group) material=group.materialIndex;
        }
        const ids = indices ? Array.from(indices.subarray(start,start+3)) : [start,start+1,start+2];
        faces.push(makeFace(ids,material));
      }
    }
    geometryCache.set(geometry,faces);
    return faces;
  }

  function fillPath(ctx,points){
    ctx.beginPath();
    points.forEach(([x,y],index)=>{
      if(index) ctx.lineTo(x,y);
      else ctx.moveTo(x,y);
    });
    ctx.closePath();
  }

  function create(container) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d',{alpha:true});
    if(!ctx) throw new Error('Canvas no está disponible.');
    container.append(canvas);
    const matrix = new T.Matrix4();
    let width=0;
    let height=0;
    let ratio=1;

    function setSize(w,h) {
      width=w;
      height=h;
      ratio=Math.min(window.devicePixelRatio || 1,1.4);
      canvas.width=Math.round(w*ratio);
      canvas.height=Math.round(h*ratio);
      ctx.setTransform(ratio,0,0,ratio,0,0);
    }

    function pointToScreen(point, transform) {
      unit.copy(point).applyMatrix4(transform);
      return [(unit.x + 1) * width / 2,(1 - unit.y) * height / 2,unit.z];
    }

    function visible(points) {
      return points.some(([x]) => x >= -2) && points.some(([x]) => x <= width+2)
        && points.some(([,y]) => y >= -2) && points.some(([,y]) => y <= height+2);
    }

    function tone(mat, normal, instanceColor) {
      if(instanceColor) blitCopy.copy(instanceColor);
      else blitCopy.copy(mat.color);
      if(!mat.isMeshBasicMaterial){
        const light=.73 + .43 * Math.max(normal.dot(key),0);
        blitCopy.multiplyScalar(light);
      }
      return blitCopy.getStyle(T.SRGBColorSpace);
    }

    function addMesh(mesh, transform, drawables, instanceColor) {
      const layer=mesh.userData.layer || 0;
      matrix.multiplyMatrices(ndc,transform);
      normals.getNormalMatrix(transform);
      if (mesh.userData.outline) {
        const points = mesh.userData.outline.map((position)=>pointToScreen(position,matrix));
        if(visible(points)) drawables.push({ points, layer, depth:0, color:tone(mesh.material,unit.set(0,1,0),instanceColor), opacity:mesh.material.opacity });
        return;
      }
      const faces = facesOf(mesh.geometry);
      for(const face of faces) {
        const mat = Array.isArray(mesh.material) ? mesh.material[face.material] : mesh.material;
        if(!mat || !mat.visible) continue;
        const points=face.vertices.map((position)=>pointToScreen(position,matrix));
        const [a,b,c]=points;
        const signed=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
        if(signed >= .015 && mat.side!==T.DoubleSide || !visible(points)) continue;
        const normal=unit.copy(face.normal).applyNormalMatrix(normals);
        if(signed>0) normal.negate();
        const image = face.imageQuad && mat.map?.image;
        const depth=points.reduce((sum,point)=>sum+point[2],0)/points.length;
        drawables.push({ points, layer, depth, color:image ? null : tone(mat,normal,instanceColor), opacity:mat.opacity, image });
      }
    }

    function addSprite(sprite,drawables,camera) {
      const [x,y,z]=pointToScreen(sprite.getWorldPosition(new T.Vector3()),ndc);
      const pixel = camera.projectionMatrix.elements[5] * height * .5;
      const sx=sprite.scale.x*pixel;
      const sy=sprite.scale.y*pixel;
      const points=[[x-sx/2,y-sy/2],[x-sx/2,y+sy/2],[x+sx/2,y+sy/2],[x+sx/2,y-sy/2]];
      if(visible(points)) drawables.push({ points, layer:6, depth:z, image:sprite.material.map?.image, opacity:sprite.material.opacity });
    }

    function drawItem(item){
      ctx.globalAlpha=item.opacity ?? 1;
      if(item.image){
        if(!item.image.width || !item.image.height) return;
        const [top,down,,right]=item.points;
        ctx.save();
        ctx.transform(right[0]-top[0],right[1]-top[1],down[0]-top[0],down[1]-top[1],top[0],top[1]);
        ctx.drawImage(item.image,0,0,1,1);
        ctx.restore();
      } else {
        fillPath(ctx,item.points);
        ctx.fillStyle=item.color;
        ctx.fill('evenodd');
        if ((item.layer === 0 || item.layer >= -40 && item.layer <= -38) && item.opacity === 1) {
          ctx.strokeStyle=item.color;
          ctx.lineWidth=.52;
          ctx.stroke();
        }
      }
    }

    function render(scene,camera) {
      if(!width||!height) return;
      scene.updateMatrixWorld();
      camera.updateMatrixWorld();
      ndc.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
      ctx.clearRect(0,0,width,height);
      const queue=[];
      scene.traverseVisible((item)=>{
        if(item.isInstancedMesh){
          const color = new T.Color();
          for(let index=0;index<item.count;index+=1) {
            item.getMatrixAt(index,tile);
            tile.premultiply(item.matrixWorld);
            if(item.instanceColor) item.getColorAt(index,color);
            addMesh(item,tile,queue,item.instanceColor ? color : null);
          }
        } else if(item.isMesh) {
          addMesh(item,item.matrixWorld,queue,null);
        } else if(item.isSprite) {
          addSprite(item,queue,camera);
        } else if(item.isPoints) {
          const positions=item.geometry.attributes.position;
          const colors=item.geometry.attributes.color;
          const star=new T.Vector3();
          ctx.globalAlpha=.75;
          for(let index=0;index<positions.count;index+=1){
            const [x,y]=pointToScreen(star.fromBufferAttribute(positions,index),ndc);
            if(x<0 || x>width || y<0 || y>height) continue;
            ctx.fillStyle=blitCopy.fromBufferAttribute(colors,index).getStyle(T.SRGBColorSpace);
            const size=index%7===0 ? 1.8:1.05;
            ctx.fillRect(x,y,size,size);
          }
          ctx.globalAlpha=1;
        }
      });
      queue.sort((a,b)=>a.layer-b.layer||b.depth-a.depth);
      queue.forEach(drawItem);
      ctx.globalAlpha=1;
    }

    return { domElement:canvas, setSize, render, shadowMap:{}, isSoftware:true };
  }

  window.grandPrixCanvas = { create };
})();
