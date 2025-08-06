
class UI {
  constructor() {
    this.renderer = new Renderer();
    this.camera = new Camera();
    this.moving = false;
  }
  get count() {
    return this.renderer.pathTracer.sampleCount;
  }
  set count(e) {
    return this.renderer.pathTracer.sampleCount = e;
  }
  resetCount() {
    this.renderer.pathTracer.sampleCount = 0;
  }
  softreset() {
    this.renderer.pathTracer.setScene(this.scene,this.camera);
  }
  reset() {
    this.renderer.setScene(this.scene,this.camera);
    this.resetCount();
  }
  setScene(scene) {
    this.scene = scene;
    this.reset();
  }
  update(timeSinceStart) {
    this.renderer.update(timeSinceStart);
  }
  mouseDown(x, y) {
    var t;
    var origin = this.camera.position;
    var ray = this.camera.getEyeRay(this.camera.mvpInv(), (x / 512) * 2 - 1, 1 - (y / 512) * 2);

    // test the selection box first
    if (this.renderer.selectedObject != null) {
      var minBounds = this.renderer.selectedObject.getMinCorner();
      var maxBounds = this.renderer.selectedObject.getMaxCorner();
      t = Cube.intersect(origin, ray, minBounds, maxBounds);

      if (t < Number.MAX_VALUE) {
        var hit = origin.add(ray.multiply(t));

        if (Math.abs(hit[0] - minBounds[0]) < 0.001) this.movementNormal = new Vector([-1, 0, 0]);
        else if (Math.abs(hit[0] - maxBounds[0]) < 0.001) this.movementNormal = new Vector([+1, 0, 0]);
        else if (Math.abs(hit[1] - minBounds[1]) < 0.001) this.movementNormal = new Vector([0, -1, 0]);
        else if (Math.abs(hit[1] - maxBounds[1]) < 0.001) this.movementNormal = new Vector([0, +1, 0]);
        else if (Math.abs(hit[2] - minBounds[2]) < 0.001) this.movementNormal = new Vector([0, 0, -1]);
        else this.movementNormal = new Vector([0, 0, +1]);

        this.movementDistance = this.movementNormal.dot(hit);
        this.originalHit = hit;
        this.moving = true;

        return true;
      }
    }

    t = Number.MAX_VALUE;
    this.renderer.selectedObject = null;

    for (var i = 0; i < this.scene.objects.length; i++) {
      var obj = this.scene.objects[i];
      if (!obj.selectable) continue;
      var objectT = obj.intersect(origin, ray);
      if (objectT < t) {
        t = objectT;
        this.renderer.selectedObject = this.scene.objects[i];
      }
    }

    return (t < Number.MAX_VALUE);
  }
  mouseMove(x, y) {
    if (this.moving) {
      var origin = this.camera.position;
      var ray = this.camera.getEyeRay(this.camera.mvpInv(), (x / 512) * 2 - 1, 1 - (y / 512) * 2);

      var t = (this.movementDistance - this.movementNormal.dot(origin)) / this.movementNormal.dot(ray);
      var hit = origin.add(ray.multiply(t));
      this.renderer.selectedObject.temporaryTranslate(hit.subtract(this.originalHit));

      // clear the sample buffer
      this.resetCount();
    }
  }
  mouseUp(x, y) {
    if (this.moving) {
      var origin = this.camera.position;
      var ray = this.camera.getEyeRay(this.camera.mvpInv(), (x / 512) * 2 - 1, 1 - (y / 512) * 2);  

      var t = (this.movementDistance - this.movementNormal.dot(origin)) / this.movementNormal.dot(ray);
      var hit = origin.add(ray.multiply(t));
      this.renderer.selectedObject.temporaryTranslate(new Vector([0, 0, 0]));
      this.renderer.selectedObject.translate(hit.subtract(this.originalHit));
      this.moving = false;
    }
  }
  render() {
    this.renderer.render();
  }
  selectLight() {
    this.renderer.selectedObject = this.scene.lights[0];
  }
  newMat() {
    return new Material(material);
  }
  addSphere() {
    this.scene.newSphere([0, 0, 0], 0.25, this.newMat());
    this.reset();
  }
  addCylinder() {
    this.scene.newCylinder([0, 0, 0], 0.25, 0.5, this.newMat());
    this.reset();
  }
  addTorus() {
    this.scene.newTorus([0, 0, 0], [0.5,0.25], this.newMat());
    this.reset();
  }
  addCone() {
    this.scene.newCone([0, 0, 0], 0.25, 0, 0.5, this.newMat());
    this.reset();
  }
  addCube() {
    this.scene.newCube([-0.25, -0.25, -0.25], [0.25, 0.25, 0.25], this.newMat());
    this.reset();
  }
  addStar() {
    var s = this.scene.newModel(star_model, this.newMat());
    s.scale([0.05,0.1,0.05]);
    this.reset();
  }
  deleteSelection() {
    for (var i = 0; i < this.scene.volumes.length; i++) {
      if (this.renderer.selectedObject == this.scene.volumes[i]) {
        this.scene.volumes.splice(i, 1);
        break;
      }
    }
    for (var i = 0; i < this.scene.lights.length; i++) {
      if (this.renderer.selectedObject == this.scene.lights[i]) {
        this.scene.lights.splice(i, 1);
        break;
      }
    }
    for (var i = 0; i < this.scene.objects.length; i++) {
      if (this.renderer.selectedObject == this.scene.objects[i]) {
        this.scene.objects.splice(i, 1);
        this.renderer.selectedObject = null;
        this.reset();
        break;
      }
    }
  }
  updateMaterial() {
    var newMaterial = parseInt(document.getElementById('material').value, 10);
    if (material != newMaterial) {
      material = newMaterial;
      this.reset();
    }
  }
  updateEnvironment() {
    var newEnvironment = parseInt(document.getElementById('environment').value, 10);
    if (environment != newEnvironment) {
      environment = newEnvironment;
      this.reset();
    }
  }
}

function RecordVideo(animate,fps,samples,duration,callback) {
  if (rendering) return;
  rendering = true;
  
  console.log("Begin Recording");
  
  var encoder = new Whammy.Video(fps); 
  
  var start = new Date();
  var counter = 0;
  var frames = Math.ceil(fps*duration);
  ui.resetCount();
  var cleared = false;
  var ticker = setInterval(()=>{
    if (cleared) return;
    counter++;
    tick(((new Date() - start) * 0.001)%1);
    render(((new Date() - start) * 0.001)%1);
    if (counter % samples == 0) {
      console.log("Rendered Frame "+Math.floor(counter/samples)+"/"+frames);
      var data = canvas.toDataURL('image/webp', 0.95);
      encoder.add(data);
      ui.resetCount();
      start = new Date();
    }
    animate(counter/samples);
    if (counter >= samples*frames) {
      cleared = true;
      clearInterval(ticker);
      console.log("Starting Compile");
      console.log(encoder);
      encoder.compile(false, output => {
        console.log("Compiled");
        
        if (typeof callback == 'function') callback(output);
        
        var url = (window.webkitURL || window.URL).createObjectURL(output);
        //console.log(url);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = 'recording.webm';
        document.body.appendChild(link);
        link.click();
        
        //*
        (window.webkitURL || window.URL).revokeObjectURL(url);
        /*/
        const video = document.createElement('video');
        video.src = url;
        video.addEventListener('error', (e) => {
          console.error('Video playback error:', e.target.error);
          console.log('Error details:', {
            code: e.target.error.code,
            message: e.target.error.message
          });
        });
        video.addEventListener('loadedmetadata', () => {
          console.log('Video metadata:', {
            duration: video.duration,
            width: video.videoWidth,
            height: video.videoHeight
          });
        });
        document.body.appendChild(video);
        */
        
        rendering = false;
      });
    }
  }, 1000 / 30);
}
function SaveRender(name) {
  console.log("Saved Render");
  var url = canvas.toDataURL('image/jpeg', 0.95);
  const link = document.createElement('a');
  link.href = url;
  link.download = (name||'render')+'.jpeg';
  document.body.appendChild(link);
  link.click();
  ui.count++;
}

////////////////////////////////////////////////////////////////////////////////
// main program
////////////////////////////////////////////////////////////////////////////////

var gl;
var WuglInst;
var ui;
var error;
var canvas;
var inputFocusCount = 0;

var angleX = 0;
var angleY = 0;
var zoomZ = 2.5;

var MATERIAL_DIFFUSE = 0;
var MATERIAL_MIRROR = 1;
var MATERIAL_GLOSSY = 2;
var MATERIAL_GLASS = 3;
var material = MATERIAL_DIFFUSE;

var YELLOW_BLUE_CORNELL_BOX = 0;
var RED_GREEN_CORNELL_BOX = 1;
var environment = YELLOW_BLUE_CORNELL_BOX;

var SceneList = [
  {
    name:"Empty Cornell Box",
    load: function() {},
    create: function() {
      var scene = new Scene();
      scene.newLight(0,[0.4, 0.5, -0.6],0.5);
      ui.camera.do_updates = true;
      ui.camera.lookat = new Vector([0, 0, 0]);
      return scene;
    }
  },
  {
    name:"Toy Box",
    load: function() {
      var toy_material = this.toy_material = new Material(2);
      toy_material.color = new Texture("assets/toy_box/wood.png");
      toy_material.depthmap = new Texture("assets/toy_box/disp.png");
      toy_material.normalmap = new Texture("assets/toy_box/normal.png");
      toy_material.heightsamp = 10;
      toy_material.heightmultiplier = 0.15;

      var brick_material = this.brick_material = new Material(2);
      brick_material.texScale = 0.5;
      brick_material.color = new Texture("assets/brick/color.jpeg");
      brick_material.normalmap = new Texture("assets/brick/normal.jpeg");
      brick_material.heightmap = new Texture("assets/brick/height.jpeg");
      brick_material.ambientocclusion = new Texture("assets/brick/ao.jpeg");
      brick_material.glossiness = new Texture("assets/brick/roughness.jpeg");
      brick_material.heightsamp = 10;
      brick_material.heightmultiplier = 0.10;
      brick_material.heightoffset = 0.5;
    },
    create: function() {
      var toy_material = this.toy_material;
      var brick_material = this.brick_material;

      var scene = new Scene();
      scene.newLight(0,[0.4, 0.5, -0.6],0.5);
      scene.background = new Background(0);
      scene.background.material = brick_material;

      var c = scene.newCube([-0.35, -1, -0.35], [0.35, -0.3, 0.35], toy_material);

      ui.camera.do_updates = true;
      ui.camera.lookat = new Vector([0, 0, 0]);
      return scene;
    }
  },
  {
    name:"Table & Chair",
    load: function() {
      var obsidian_material = this.obsidian_material = new Material(1);
      obsidian_material.color = new Texture("assets/obsidian/color.png");
      obsidian_material.normalmap = new Texture("assets/obsidian/normal.png");
      obsidian_material.heightmap = new Texture("assets/obsidian/height.png");
      obsidian_material.normalstrength = 0.6;
      obsidian_material.heightoffset = 0.7;
      obsidian_material.heightmultiplier = 0.05;
      obsidian_material.heightsamp = 10;
      obsidian_material.texScale = 0.5;

      var wood_material = this.wood_material = new Material(0);
      wood_material.color = new Texture("assets/wood/color.jpg");
      wood_material.normalmap = new Texture("assets/wood/normal.jpg");
      wood_material.heightmap = new Texture("assets/wood/height.jpg");
      wood_material.heightoffset = 0.9;
      wood_material.texScale = 0.3;

      var sunsetbackground = this.sunsetbackground = new Background(0);
      sunsetbackground.skybox = new Texture("assets/skybox.jpg");
      //sunsetbackground.material = bricks2_material;
    },
    create: function() {
      var obsidian_material = this.obsidian_material;
      var wood_material = this.wood_material;
      var sunsetbackground = this.sunsetbackground;

      var scene = new Scene();
      scene.newLight(1,[1.0, 0.3, 0],[0.7*1/.7,0.4*1/.7,0.1*1/.7]);
      //scene.newLight(0,[0.4, 0.5, -0.6],0.5);
      scene.background = sunsetbackground;

      scene.newComposite([
        {min:[-0.5, -0.35, -0.5], max:[0.3, -0.3, 0.5]},
        {min:[-0.45, -1, -0.45], max:[-0.4, -0.35, -0.4]},
        {min:[0.2, -1, -0.45], max:[0.25, -0.35, -0.4]},
        {min:[-0.45, -1, 0.4], max:[-0.4, -0.35, 0.45]},
        {min:[0.2, -1, 0.4], max:[0.25, -0.35, 0.45]},
      ],[],obsidian_material);
      
      scene.newComposite([
        {min:[0.3, -0.6, -0.2], max:[0.7, -0.55, 0.2]},
        {min:[0.3, -1, -0.2], max:[0.35, -0.6, -0.15]},
        {min:[0.3, -1, 0.15], max:[0.35, -0.6, 0.2]},
        {min:[0.65, -1, -0.2], max:[0.7, 0.1, -0.15]},
        {min:[0.65, -1, 0.15], max:[0.7, 0.1, 0.2]},
        {min:[0.65, 0.05, -0.15], max:[0.7, 0.1, 0.15]},
        {min:[0.65, -0.55, -0.09], max:[0.7, 0.1, -0.03]},
        {min:[0.65, -0.55, 0.03], max:[0.7, 0.1, 0.09]},
      ],[],wood_material);

      // sphere on table
      //scene.newSphere([-0.1, -0.05, 0], 0.25);

      ui.camera.do_updates = true;
      ui.camera.lookat = new Vector([0, 0, 0]);
      return scene;
    }
  },
  {
    name:"Pumpkin Patch",
    load: function() {
      var pumpkin_model = this.pumpkin_model = new Model("assets/pumpkin_tall.obj",()=>{
        pumpkin_model.bakeTransform(Transform.RotationX(-Math.PI/2));
        pumpkin_model.renormalize();
        pumpkin_model.calculateVertexNormals();
        pumpkin_model.calculateSphericalUVs();
        pumpkin_model.generateBVH();
      });
      var lakebackground = this.lakebackground = new Background(0);
      lakebackground.skyboxMult = 1;
      lakebackground.skybox = new Texture("assets/lake.jpeg");
      //lakebackground.skybox.filterCode = function(tex,uv) {
      //  return `(length(${uv}-vec2(0.1,0.4)) > 0.05 ? ${tex} : vec4(10))`;
      //};
    },
    create: function() {
      var pumpkin_model = this.pumpkin_model;
      var lakebackground = this.lakebackground;
      
      var scene = new Scene();
      scene.newLight(1,[0.6, 0.5, -0.4],1,0.05);
      scene.background = lakebackground;

      var s = scene.newModel(pumpkin_model,new Material(3,[1,0.46,0.1]));
      s.material.concentration = 3;
      s.ior = 1.5;
      var m = s.getMinCorner()[1];
      s.smoothing = true;
      s.translate([-0.15,-1.02,0.25]);
      s.scale([0.2,0.2,0.2]);
      s.translate([0,-m,0]);

      var s = scene.newModel(pumpkin_model,new Material(4,[1,0.46,0.1]));
      s.ior = 1.5;
      var m = s.getMinCorner()[1];
      s.translate([-0.35,-1.02,-0.35]);
      s.scale([0.35,0.42,0.35]);
      s.translate([0,-m,0]);

      var s = scene.newModel(pumpkin_model,new Material(0,[0.94,0.87,0.76]));
      var m = s.getMinCorner()[1];
      s.smoothing = true;
      s.translate([0.4,-1.02,-0.1]);
      s.scale([0.4,0.25,0.4]);
      s.translate([0,-m,0]);

      var c = scene.newCube([-0.5,0,-0.01], [0.5,1,0.01], new Material(1,[1,1,1]));
      c.translate([-0.9,-0.985,-1.2]);
      c.rotateY(Math.PI/6);

      var f = scene.newComposite([
        {min:[-0.515, -0.015, -0.015], max:[-0.485, 1.015, 0.015]},
        {min:[0.485, -0.015, -0.015], max:[0.515, 1.015, 0.015]},
        {min:[-0.515, -0.015, -0.015], max:[0.515, 0.015, 0.015]},
        {min:[-0.515, 0.985, -0.015], max:[0.515, 1.015, 0.015]},
        ], [], new Material(0,[0.5,0.23,0.05]));
      f.translate([-0.9,-0.985,-1.2]);
      f.rotateY(Math.PI/6);

      ui.camera.do_updates = false;
      ui.camera.position = new Vector([-0.05, 0, 2]);
      ui.camera.lookat = new Vector([-0.05, -0.2, 1]);

      scene.bounces = 8;

      return scene;
    }
  },
  {
    name:"Glow Dragon",
    load: function() {
      var dragon_model = this.dragon_model = new Model("assets/dragon-1.obj",()=>{
        //dragon_model.normals = [];
        //dragon_model.trianglenormals = [];
        //dragon_model.triangleuvs = [];

        //dragon_model.bakeTransform(Transform.RotationX(-Math.PI/2).multiply(Transform.Scale(0.005)));
        dragon_model.bakeTransform(Transform.RotationX(-Math.PI/2));
        dragon_model.renormalize();
        //dragon_model.calculateVertexNormals();
        dragon_model.generateBVH();
      });
    },
    create: function() {
      var dragon_model = this.dragon_model
      
      var scene = new Scene();
      scene.background = new Background(2);
      //scene.newLight(1,[0.6, 0.5, -0.4],1,0.05);
      
      //var colors = []
      for (var x = 0; x <= 4; x++) {
        //colors.push([]);
        for (var y = 0; y <= 4; y++) {
          var h = Math.random()*360;//Math.asin(Math.random()*2-1)/Math.PI*60-5;
          //colors[x].push(h);
          scene.newSphere([-0.5+0.25*x, -0.5+0.25*y, -0.93], 0.12, new Material(6,Wugl.Color.hsl(h,75+25*Math.random(),55)));
        }
      }
      for (var x = 0; x <= 4; x++) {
        for (var y = 0; y <= 4; y++) {
          var h = Math.random()*360;//Math.random()*75+90;
          scene.newSphere([-0.5+0.25*x, -0.5+0.25*y, 0.93], 0.12, new Material(6,Wugl.Color.hsl(h,75+25*Math.random(),55)));
        }
      }
      
      var s = scene.newModel(dragon_model,new Material(4,[1,1,1]));
      //s.smoothing = true;
      var m = s.getMinCorner()[1];
      s.translate([-0.1,-1.0,0]);
      //s.scale(0.01);
      //s.translate([0,-0.6,0]);
      s.scale(0.8);
      s.translate([0,-m,0]);
      
      ui.camera.do_updates = false;
      ui.camera.lookat = new Vector([-0.2,-0.1,0.1]);
      ui.camera.position = new Vector([-1.65,0.7,1]);

      //scene.bounces = 8;
      
      return scene;
    }
  },
  {
    name:"Bunny",
    load: function() {
      var bunny_model = this.bunny_model = new Model("assets/bunny/model.obj",()=>{
        //bunny_model.bakeTransform(Transform.RotationX(-Math.PI/2));
        bunny_model.renormalize();
        //bunny_model.calculateVertexNormals();
        //bunny_model.calculateSphericalUVs();
        bunny_model.generateBVH();
      });
      var bunny_material = this.bunny_material = new Material(2);
      bunny_material.color = new Texture("assets/bunny/color.jpg");
      bunny_material.normalmap = new Texture("assets/bunny/normal.png");
      bunny_material.roughness = new Texture("assets/bunny/roughness.jpeg");
      bunny_material.roughness.filterCode = function(tex,uv){return "("+tex(uv)+"*5.)"};
      bunny_material.ambientocclusion = new Texture("assets/bunny/ao.jpeg");

      var lakebackground = this.lakebackground = new Background(0);
      lakebackground.skyboxMult = 1;
      lakebackground.skybox = new Texture("assets/lake.jpeg");
      //lakebackground.skybox.filterCode = function(tex,uv) {
      //  return `(length(${uv}-vec2(0.1,0.4)) > 0.05 ? ${tex(uv)} : vec4(10))`;
      //};
    },
    create: function() {
      var bunny_model = this.bunny_model;
      var bunny_material = this.bunny_material;
      var lakebackground = this.lakebackground;
      
      var scene = new Scene();
      scene.newLight(1,[-0.6, 0.5, -0.4],1,0.05);
      scene.background = lakebackground;

      var s = scene.newModel(bunny_model,bunny_material);
      var m = s.getMinCorner()[1];
      s.smoothing = true;
      s.translate([0,-1,0]);
      s.scale(0.7);
      s.translate([0,-m,0]);

      ui.camera.do_updates = true;
      ui.camera.lookat = new Vector([0,-0.5,0]);

      scene.bounces = 4;

      return scene;
    }
  },
  {
    name:"Terrain",
    load: function() {
      var gl = WuglInst.gl;
      //var lat = 36.130, lon = -112.125; // Grand Canyon
      //var lat = 37.6308, lon = -119.0326; // Mammoth
      var lat = 33.8788, lon = -117.5760; // Corona
      //var lat = 37.7749, lon = -122.4194; // San Francisco
      this.terrain_data = new TerrainData();
      this.terrain_data.generate(lat,lon,13,8,2,2);
    },
    create: function() {
      var terrain_data = this.terrain_data;

      var scene = new Scene();
      scene.background = new Background(3);
      //scene.background = new Background(0);
      ////scene.background.skybox = spacebackground.skybox;
      scene.background.atmosphere = true;
      //scene.background.groundHeight = -3863;
      scene.background.groundHeight = -1000;
      //scene.background.groundPlane = true;
      //scene.background.material = new Material(3,[0.985,0.99,0.995]);
      //scene.background.material.ior = 1.3;
      //scene.background.material.normalmap = obsidian_material.normalmap;
      //scene.background.material.normalmap.filterCode = function(tex,uv){return tex(`${uv}*0.01`)};
      //scene.background.material.heightmap = obsidian_material.heightmap;
      //scene.background.material.heightmap.filterCode = function(tex,uv){return tex(`${uv}*0.01`)};
      //scene.newLight(1,[-0.6, 0.5, -0.4],1,0.02);
      scene.newLight(1,[0.5, 1, 0],1,0.02);
      
      var elevation = -scene.background.groundHeight;
      scene.newTerrainMap(terrain_data,elevation,1000);

      ui.camera.do_updates = true;
      ui.camera.lookat = new Vector([0, 0, 0]);
      return scene;
    }
  },
];

var rendering = false;
function setup() {
  var preset = document.getElementById("preset");
  for (var i = SceneList.length-1; i >= 0; i--) (function(i){
    var btn = document.createElement("button");
    btn.innerHTML = SceneList[i].name;
    SceneList[i].load();
    btn.onclick = function() {
      ui.setScene(SceneList[i].create());
    }
    var br = document.createElement("br");
    preset.after(br,btn);
  })(i);
  
  ui = new UI();
  ui.setScene(SceneList[0].create());
  var start = new Date();
  setInterval(function () { 
    if (rendering) return;
    tick(((new Date() - start) * 0.001) % 1);
  }, 1000 / 30);
  requestAnimationFrame(render);
}

var capture = false;
function render() {
  if (rendering) return;
  ui.camera.update(zoomZ,angleX,angleY);
  ui.updateMaterial();
  ui.updateEnvironment();
  ui.render();
  if (!debugMode) {
    if (capture) {
      SaveRender("render-"+ui.count);
      capture = false;
    }
    if (ui.count == 1024) SaveRender("render-1024");
    if (ui.count == 2048) SaveRender("render-2048");
    if (ui.count == 4096) SaveRender("render-4096");
  }
  requestAnimationFrame(render);
}

function tick(timeSinceStart) {
  ui.update(timeSinceStart);
}

window.onload = function () {
  gl = null;
  error = document.getElementById('error');
  canvas = document.getElementById('canvas');
  
  WuglInst = new Wugl.Context(canvas);
  gl = WuglInst.gl;
  
  if (gl) {
    error.innerHTML = 'Loading...';

    // keep track of whether an <input> is focused or not (will be no only if inputFocusCount == 0)
    var inputs = document.getElementsByTagName('input');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].onfocus = function () { inputFocusCount++; };
      inputs[i].onblur = function () { inputFocusCount--; };
    }

    material = parseInt(document.getElementById('material').value, 10);
    environment = parseInt(document.getElementById('environment').value, 10);
    
    error.style.zIndex = -1;
    
    setup();
  } else {
    error.innerHTML = `Your browser does not support WebGL.<br>Please see <a href="https://get.webgl.org/get-a-webgl-implementation/">Getting a WebGL Implementation</a>.`;
  }
};

function elementPos(element) {
  var x = 0, y = 0;
  while (element.offsetParent) {
    x += element.offsetLeft;
    y += element.offsetTop;
    element = element.offsetParent;
  }
  return { x: x, y: y };
}

function eventPos(event) {
  return {
    x: event.clientX + document.body.scrollLeft + document.documentElement.scrollLeft,
    y: event.clientY + document.body.scrollTop + document.documentElement.scrollTop
  };
}

function canvasMousePos(event) {
  var mousePos = eventPos(event);
  var canvasPos = elementPos(canvas);
  return {
    x: mousePos.x - canvasPos.x,
    y: mousePos.y - canvasPos.y
  };
}

var mouseDown = false, oldX, oldY;

document.onmousedown = function(event) {
  var mouse = canvasMousePos(event);
  oldX = mouse.x;
  oldY = mouse.y;

  if (mouse.x >= 0 && mouse.x < 512 && mouse.y >= 0 && mouse.y < 512) {
    mouseDown = !ui.mouseDown(mouse.x, mouse.y);

    // disable selection because dragging is used for rotating the camera and moving objects
    return false;
  }

  return true;
};

document.onmousemove = function (event) {
  var mouse = canvasMousePos(event);

  if (mouseDown) {
    // update the angles based on how far we moved since last time
    angleY -= (mouse.x - oldX) * 0.01;
    angleX += (mouse.y - oldY) * 0.01;

    // don't go upside down
    angleX = Math.max(angleX, -Math.PI / 2 + 0.01);
    angleX = Math.min(angleX, Math.PI / 2 - 0.01);

    // clear the sample buffer
    ui.resetCount();

    // remember this coordinate
    oldX = mouse.x;
    oldY = mouse.y;
  } else {
    ui.mouseMove(mouse.x, mouse.y);
  }
};

document.onmouseup = function (event) {
  mouseDown = false;

  var mouse = canvasMousePos(event);
  ui.mouseUp(mouse.x, mouse.y);
  
  ui.softreset();
};

var rotatekey = {
  x:0,
  y:0,
  s:0,
  sx:false,
};
document.onkeydown = function (event) {
  // if there are no <input> elements focused
  if (inputFocusCount == 0) {
    console.log(event.keyCode);
    if (event.keyCode == 37) {
      rotatekey.y = 0.1;
      return false;
    }
    if (event.keyCode == 39) {
      rotatekey.y = -0.1;
      return false;
    }
    if (event.keyCode == 38) {
      rotatekey.x = 0.1;
      return false;
    }
    if (event.keyCode == 40) {
      rotatekey.x = -0.1;
      return false;
    }
    if (event.keyCode == 187) {
      rotatekey.s = 1.025;
      return false;
    }
    if (event.keyCode == 189) {
      rotatekey.s = 1/1.025;
      return false;
    }
    if (event.keyCode == 17) {
      rotatekey.sx = true;
      return false;
    }
    // if backspace or delete was pressed
    if (event.keyCode == 8 || event.keyCode == 46) {
      ui.deleteSelection();

      // don't let the backspace key go back a page
      return false;
    }
  }
};

document.onkeyup = function (event) {
  if (inputFocusCount == 0) {
    if (event.keyCode == 37 || event.keyCode == 39) rotatekey.y = 0;
    if (event.keyCode == 38 || event.keyCode == 40) rotatekey.x = 0;
    if (event.keyCode == 187 || event.keyCode == 189) rotatekey.s = 0;
    if (event.keyCode == 17) rotatekey.sx = false;
  }
  //return 0
};

setInterval(()=>{
  if (!ui.renderer.selectedObject) return;
  if (rotatekey.y) {
    ui.renderer.selectedObject.rotateY(rotatekey.y);
    ui.resetCount();
  }
  if (rotatekey.x) {
    ui.renderer.selectedObject.rotateX(rotatekey.x);
    ui.resetCount();
  }
  if (rotatekey.s) {
    var s = rotatekey.s;
    if (rotatekey.sx) s = [1,s,1];
    ui.renderer.selectedObject.scale(s);
    ui.resetCount();
  }
},100);

document.addEventListener('touchstart', function (event) {
  if (event.target === canvas && event.touches.length === 1) {
    var mouse = canvasMousePos(event.touches[0]);
    oldX = mouse.x;
    oldY = mouse.y;
    mouseDown = true;
    event.preventDefault();
  } else {
    mouseDown = false;
  }
}, { pasive: false });

document.addEventListener('touchmove', function (event) {
  if (mouseDown && event.touches.length === 1) {
    document.onmousemove(event.touches[0]);
  }
}, { pasive: false });

document.addEventListener('touchend', function () {
  mouseDown = false;
}, { pasive: false });

document.addEventListener('touchcancel', function () {
  mouseDown = false;
}, { pasive: false });
/*
	var vid = new Whammy.Video();
	vid.add(canvas or data url)
	vid.compile()
*/

function spinRecord2() {
  //var samp = 16;
  var samp = 128;
  //var samp = 1024;
  //var fps = 15;
  var fps = 24;
  //var dur = 4;
  var dur = 2;
  var velY = 4;
  angleY = 0;
  RecordVideo((t)=>{
    //if (t % 1 != 0) return;
    angleY = t*Math.PI*2/dur/fps;
    //var obj = ui.scene.objects[1];
    //obj.rotateY(Math.PI/dur/fps/samp);
    //obj.translate([0,2*Math.sin(t*Math.PI*2/dur/fps)/dur/fps/samp,0]);
    /*if (t/fps > 0.25 && t/fps < 2.25) {
      obj.rotateY(Math.PI/dur/fps/samp);
      velY -= 8/dur/fps/samp;
      obj.translate([0,velY/dur/fps/samp,0]);
    }*/
  },fps,samp,dur);
}

function bounceRecord2(i,samp) {
  var fps = 24;
  var dur = 2;
  var velY = -4;
  var posY = 0;
  var obj = ui.scene.objects[i];
  var transform = obj.getTransform();
  RecordVideo((t)=>{
    obj.setTransform(transform);
    obj.rotateY(Math.PI/dur/fps/samp);
    /*if (posY < 0) {
      velY -= 500*posY/dur/fps/samp;
    }
    velY -= 8/dur/fps/samp;
    var sc = 1+(velY*velY+10*posY-10)/100;
    posY += velY/dur/fps/samp;
    obj.scale([1/sc,sc,1/sc]);
    obj.translate([0,2*(posY+0.13),0]);
    obj.translate(0,0.35/2,0);*/
    
    //velY -= 8/dur/fps/samp;
    //obj.translate([0,velY/dur/fps/samp,0]);
  },fps,samp,dur*1.15*2,(t)=>{
    obj.setTransform(transform);
  });
}

/*function record(animate,fps,samples,duration,callback) {
  if (rendering) return;
  rendering = true;
  
  var ocanvas = document.createElement("canvas");
  ocanvas.width = canvas.width;
  ocanvas.height = canvas.height;
  var ctx = ocanvas.getContext("2d");
  
  document.body.appendChild(ocanvas);
  
  console.log(ctx);
  
  var list = [];
  
  var start = new Date();
  var counter = 0;
  var frames = fps*duration;
  var ticker = setInterval(()=>{
    counter++;
    tick((new Date() - start) * 0.001);
    if (counter % samples == 0) {
      console.log("Rendered Frame "+Math.floor(counter/samples)+"/"+frames);
      ctx.drawImage(canvas,0,0);
      var data = ctx.getImageData(0, 0, ocanvas.width, ocanvas.height);
      list.push(data);
      ui.resetCount();
      start = new Date();
    }
    animate(counter/samples);
    if (counter == samples*frames) {
      clearInterval(ticker);
      //console.log(list);
      const stream = ocanvas.captureStream(fps); // 30 FPS
      //const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' });
      let chunks = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size <= 0) return;
        chunks.push(event.data);
      }
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        if (typeof callback == 'function') callback(blob);
        const url = URL.createObjectURL(blob);

        // Create a download link
        const a = document.createElement('a');
        a.href = url;
        a.download = 'recording.webm';
        a.click();

        // Clean up the URL to free memory
        URL.revokeObjectURL(url);
        
        rendering = false;
      };
      var i = 0;
      var animate = setInterval(()=>{
        if (i >= list.length) {
          clearInterval(animate);
          setTimeout(()=>{
            console.log("Stopping Recording");
            mediaRecorder.stop();
          },1000/fps/4);
          return;
        }
        ctx.putImageData(list[i],0,0);
        i++;
      },1000/fps);
      setTimeout(()=>{
        console.log("Starting Recording");
        mediaRecorder.start();
      },1000/fps/4);
    }
  }, 1000/60);
}*/

//setTimeout(spinRecord2,5000);
