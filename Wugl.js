
var Wugl = {
  version: '1',
  /*
  gl_version: 'experimental-webgl',
  /*/
  gl_version: 'webgl2',
  //*/
  gl_options: {
    //preserveDrawingBuffer: true,
  },
  precision: 1e-6,
};

// -----------
//  Rendering
// -----------

Wugl.Context = class {
  constructor(canvas,onerror) {
    this.canvas = canvas;
    this.gl = null;
    this.gl_version = Wugl.gl_version;
    this.gl_options = Wugl.gl_options;
    try { this.gl = canvas.getContext(this.gl_version, this.gl_options); } catch (e) { onerror(e) }
  }
  clear(color) {
    const gl = this.gl;
    color = Wugl.Color.force(color);
    gl.clearColor(...color); // Clear background to black
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  createProgram(vertexSource,fragmentSource) {
    var program = new Wugl.Program(this, vertexSource, fragmentSource);
    program.compileShader(vertexSource,fragmentSource);
    return program;
  }
  createTexture(width,height,options) {
    var texture = new Wugl.Texture2D(this,width,height,options);
    return texture;
  }
  create3DTexture(width,height,depth,options) {
    var texture = new Wugl.Texture3D(this,width,height,depth,options);
    return texture;
  }
  createGeometry(type,options) {
    var geometry = new Wugl.Geometry[type](this,options);
    return geometry;
  }
  createFramebuffer(options) {
    var framebuf = new Wugl.Framebuffer(this,options);
    return framebuf;
  }
  saveImage(name,type,res) {
    /*
    var url = canvas.toDataURL('image/'+type, res);
    const link = document.createElement('a');
    link.href = url;
    link.download = name+'.'+type;
    document.body.appendChild(link);
    link.click();
    /*/
    this.canvas.toBlob(function(blob){
      var url = (window.webkitURL || window.URL).createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name+'.'+type;
      document.body.appendChild(link);
      link.click();
      (window.webkitURL || window.URL).revokeObjectURL(url);
    },'image/'+type, res);
    //*/
  }
};

Wugl.Program = class {
  constructor(context) {
    this.context = context;
    this.vertexSource = '';
    this.fragmentSource = '';
    this.program = null;
    this.uniforms = {};
    this.attributes = {};
  }
  compileSource(source, type) {
    const gl = this.context.gl;
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.log(source.split("\n").map((v,i)=>i+": "+v).join("\n"));
      console.error(gl.getShaderInfoLog(shader));
      alert(gl.getShaderInfoLog(shader));
      throw new Error('compile error: ' + gl.getShaderInfoLog(shader));
    }
    return shader;
  }
  parseSource(code,type) {
    if (this.context.gl_version == 'webgl2') {
      code = "#version 300 es\n"+code;
      if (type == 0) { // Vertex
        code = code.replace(/attribute /g,"in ");
        code = code.replace(/varying /g,"out ");
      }
      if (type == 1) { // Fragment
        code = code.replace(/varying /g,"in ");
        code = code.replace(/(void\s+main)/g,"out vec4 FragColor;\n$1");
        code = code.replace(/gl_FragColor/g,"FragColor");
      }
      code = code.replace(/texture2D\s*\(/g,"texture(");
      code = code.replace(/texture3D\s*\(/g,"texture(");
      code = code.replace(/textureSize2D\s*\(/g,"textureSize(");
      code = code.replace(/textureSize3D\s*\(/g,"textureSize(");
      code = code.replace(/texelFetch2D\s*\(/g,"texelFetch(");
      code = code.replace(/texelFetch3D\s*\(/g,"texelFetch(");
    } else {
      code = code.replace(/precision (low|medium|high)p sampler3D;/,``);
      code = code.replace(/precision (low|medium|high)p float;/,`
  precision $1p float;

  mat2 transpose(mat2 m) {
    return mat2(
      m[0][0], m[1][0],
      m[0][1], m[1][1]
    );
  }
  mat3 transpose(mat3 m) {
    return mat3(
      m[0][0], m[1][0], m[2][0],
      m[0][1], m[1][1], m[2][1],
      m[0][2], m[1][2], m[2][2]
    );
  }
  mat4 transpose(mat4 m) {
    return mat4(
      m[0][0], m[1][0], m[2][0], m[3][0],
      m[0][1], m[1][1], m[2][1], m[3][1],
      m[0][2], m[1][2], m[2][2], m[3][2],
      m[0][3], m[1][3], m[2][3], m[3][3]
    );
  }
  `);
      code = code.replace(/uniform\s+sampler2D\s+(\w+)\s*;/,`uniform sampler2D $1;
uniform vec2 $1_size;
vec4 texelFetch2D_$1(vec2 pos, int mip) {
  pos = floor(pos)/$1_size;
  return texture2D($1,pos);
}
`);
      code = code.replace(/uniform\s+sampler3D\s+(\w+)\s*;/,`uniform sampler2D $1;
uniform vec3 $1_size;
uniform int $1_filter;
vec4 texture3D_$1(vec3 pos) {
  pos *= $1_size;
  vec4 samp = vec4(0);
  if ($1_filter == 1) {
    float posz = pos.z - 0.5;
    float rposz = floor(posz);
    for (float i = 0.; i < 2.; i+=1.) {
      float weight = 1. - abs(posz - (rposz + i));
      vec2 uv = vec2(pos.x / $1_size.x, (pos.y + (rposz + i) * $1_size.y) / ($1_size.y * $1_size.z));
      samp += weight * texture2D($1,uv);
    }
  } else {
    pos = floor(pos);
    vec2 uv = vec2(pos.x / $1_size.x, (pos.y + pos.z * $1_size.y) / ($1_size.y * $1_size.z));
    samp = texture2D($1,uv);
  }
  return samp;
}
vec4 texelFetch3D_$1(vec3 pos, int mip) {
  pos = floor(pos);
  vec2 uv = vec2(pos.x / $1_size.x, (pos.y + pos.z * $1_size.y) / ($1_size.y * $1_size.z));
  return texture2D($1,uv);
}`);
      code = code.replace(/textureSize2D\s*\(\s*(\w+?)\s*,\s*\d+\s*\)/g,"$1_size");
      code = code.replace(/textureSize3D\s*\(\s*(\w+?)\s*,\s*\d+\s*\)/g,"$1_size");
      code = code.replace(/texelFetch2D\s*\(\s*(\w+?)\s*\,/g,"texelFetch2D_$1(");
      code = code.replace(/texelFetch3D\s*\(\s*(\w+?)\s*\,/g,"texelFetch3D_$1(");
      code = code.replace(/texture3D\s*\(\s*(\w+?)\s*\,/g,"texture3D_$1(");
      code = code.replace(/ivec(\d)/g,"vec$1");
      code = code.replace(/uint/g,"int");
    }
    return code;
  }
  compileShader(vertexSource, fragmentSource) {
    const gl = this.context.gl;
    this.vertexSource = this.parseSource(vertexSource,0);
    this.fragmentSource = this.parseSource(fragmentSource,1);
    var shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, this.compileSource(this.vertexSource, gl.VERTEX_SHADER));
    gl.attachShader(shaderProgram, this.compileSource(this.fragmentSource, gl.FRAGMENT_SHADER));
    gl.linkProgram(shaderProgram);
    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
      throw new Error('link error: ' + gl.getProgramInfoLog(shaderProgram));
    }
    this.program = shaderProgram;
  }
  use() {
    const gl = this.context.gl;
    gl.useProgram(this.program);
  }
  setUniform(loc,value) {
    this.uniforms[loc] = value;
  }
  setAttribute(loc,value) {
    this.attributes[loc] = value;
  }
  setupUniforms() {
    const gl = this.context.gl;
    var texid = 0;
    for (var name in this.uniforms) {
      var loc = gl.getUniformLocation(this.program, name);
      if (loc == null) continue;
      var value = this.uniforms[name];
      if (value instanceof Wugl.Texture2D) {
        gl.activeTexture(gl["TEXTURE"+texid]);
        gl.bindTexture(gl.TEXTURE_2D, value.texture);
        gl.uniform1i(loc, texid);
        if (Wugl.gl_version != "webgl2") {
          var size_loc = gl.getUniformLocation(this.program, name+"_size");
          gl.uniform2fv(size_loc, new Float32Array([value.width,value.height]));
        }
        texid++;
        continue;
      }
      if (value instanceof Wugl.Texture3D) {
        gl.activeTexture(gl["TEXTURE"+texid]);
        if (Wugl.gl_version == "webgl2") {
          gl.bindTexture(gl.TEXTURE_3D, value.texture);
        } else {
          gl.bindTexture(gl.TEXTURE_2D, value.texture);
          var size_loc = gl.getUniformLocation(this.program, name+"_size");
          gl.uniform3fv(size_loc, new Float32Array([value.width,value.height,value.depth]));
          var filter_loc = gl.getUniformLocation(this.program, name+"_filter");
          gl.uniform1i(filter_loc, Number(value.options.filter == gl.LINEAR));
        }
        gl.uniform1i(loc, texid);
        texid++;
        continue;
      }
      if (value instanceof Array) {
        var len = value.length;
        if (value[0] instanceof Array) {
          gl[`uniformMatrix${len}fv`](loc, false, new Float32Array(value.flat()));
        } else {
          gl[`uniform${len}fv`](loc, new Float32Array(value));
        }
        continue;
      }
      if (typeof value == "number") {
        gl.uniform1f(loc, value);
      }
    }
  }
  setupAttributes() {
    const gl = this.context.gl;
    for (var name in this.attributes) {
      var loc = gl.getAttribLocation(this.program, name);
      if (loc == null) continue;
      var value = this.attributes[name];
      gl.enableVertexAttribArray(loc);
      value.setAttribute(loc);
    }
  }
  deleteProgram() {
    const gl = this.context.gl;
    gl.deleteProgram(this.program);
  }
  render(geometry) {
    const gl = this.context.gl;
    this.use();
    geometry.setupRender(this);
    this.setupUniforms();
    this.setupAttributes();
    geometry.render();
  }
  renderToTexture(geometry,texture,framebuffer) {
    framebuffer.renderToTexture(this,geometry,texture);
  }
};

Wugl.Texture = class {
  constructor(context) {
    this.context = context;
  }
}
Wugl.Texture2D = class extends Wugl.Texture {
  constructor(context,width,height,options) {
    super(context);
    const gl = context.gl;
    this.texture = gl.createTexture();
    this.width = width||1;
    this.height = height||1;
    this.options = {
      level: 0,
      format: gl.RGBA,
      border: 0,
      filter: gl.NEAREST,
      wrap: gl.CLAMP_TO_EDGE,
      mipmap: true,
      sourceFormat: gl.RGBA,
      sourceType: gl.UNSIGNED_BYTE,
    };
    for (var i in options) this.options[i] = options[i];
  }
  fillData(data,width,height) {
    const gl = this.context.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (data instanceof Image) {
    	this.width = data.width;
      this.height = data.height;
    	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(
        gl.TEXTURE_2D,
        this.options.level,
        this.options.format,
        this.options.sourceFormat,
        this.options.sourceType,
        data,
      );
    } else if (data instanceof HTMLCanvasElement) {
      this.width = data.width;
      this.height = data.height;
      data = data.getContext("2d");
      data = new Uint8Array(data.getImageData(0,0,this.width,this.height).data);
    	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(
        gl.TEXTURE_2D,
        this.options.level,
        this.options.format,
        this.width,
        this.height,
        this.options.border,
        this.options.sourceFormat,
        this.options.sourceType,
        data,
      );
    } else {
      if (width) this.width = width;
      if (height) this.height = height;
      //const data = new Uint8Array(data);
    	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(
        gl.TEXTURE_2D,
        this.options.level,
        this.options.format,
        this.width,
        this.height,
        this.options.border,
        this.options.sourceFormat,
        this.options.sourceType,
        data,
      );
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // power of 2 in both dimensions.
    if (Math.isPowerOf2(width) && Math.isPowerOf2(height) && this.options.mipmap) {
      // Yes, it's a power of 2. Generate mips.
      gl.generateMipmap(gl.TEXTURE_2D);
    } else {
      // No, it's not a power of 2. Turn off mips
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this.options.wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, this.options.wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.options.filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.options.filter);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
};
Wugl.TextureCube = class extends Wugl.Texture {
  constructor(context,width,height,options) {
    super(context);
    const gl = context.gl;
    this.texture = gl.createTexture();
    this.width = width||1;
    this.height = height||1;
    this.options = {
      level: 0,
      format: gl.RGBA,
      border: 0,
      filter: gl.NEAREST,
      wrap: gl.CLAMP_TO_EDGE,
      mipmap: true,
      sourceFormat: gl.RGBA,
      sourceType: gl.UNSIGNED_BYTE,
    };
    for (var i in options) this.options[i] = options[i];
  }
  fillData(data,face,width,height) {
    const gl = this.context.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.texture);
    var target = {
      "+x":gl.TEXTURE_CUBE_MAP_POSITIVE_X,
      "+y":gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
      "+z":gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
      "-x":gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
      "-y":gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
      "-z":gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
    }[face];
    if (data instanceof Image) {
      this.width = data.width;
      this.height = data.height;
      gl.texImage2D(
        target,
        this.options.level,
        this.options.format,
        this.options.sourceFormat,
        this.options.sourceType,
        data,
      );
    } else {
      if (width) this.width = width;
      if (height) this.height = height;
      //const data = new Uint8Array(data);
      gl.texImage2D(
        target,
        this.options.level,
        this.options.format,
        this.width,
        this.height,
        this.options.border,
        this.options.sourceFormat,
        this.options.sourceType,
        data,
      );
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, this.options.wrap);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, this.options.wrap);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, this.options.filter);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, this.options.filter);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
  }
};
Wugl.Texture3D = class extends Wugl.Texture {
  constructor(context,width,height,depth,options) {
    super(context);
    const gl = context.gl;
    this.texture = gl.createTexture();
    this.width = width||1;
    this.height = height||1;
    this.depth = depth||1;
    this.options = {
      level: 0,
      format: gl.RGBA,
      border: 0,
      filter: gl.NEAREST,
      wrap: gl.CLAMP_TO_EDGE,
      mipmap: true,
      sourceFormat: gl.RGBA,
      sourceType: gl.UNSIGNED_BYTE,
    };
    for (var i in options) this.options[i] = options[i];
  }
  fillData(data,width,height,depth) {
    const gl = this.context.gl;
    gl.activeTexture(gl.TEXTURE0);
    if (width) this.width = width;
    if (height) this.height = height;
    if (depth) this.depth = depth;
    if (this.context.gl_version == "webgl2") {
      gl.bindTexture(gl.TEXTURE_3D, this.texture);
      //const data = new Uint8Array(data);
      gl.texImage3D(
        gl.TEXTURE_3D,
        this.options.level,
        this.options.format,
        this.width,
        this.height,
        this.depth,
        this.options.border,
        this.options.sourceFormat,
        this.options.sourceType,
        data,
      );
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, this.options.wrap);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, this.options.wrap);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, this.options.wrap);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, this.options.filter);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, this.options.filter);
      gl.bindTexture(gl.TEXTURE_3D, null);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      var width2 = this.width
      var height2 = this.height*this.depth;
      gl.texImage2D(
        gl.TEXTURE_2D,
        this.options.level,
        this.options.format,
        width2,
        height2,
        this.options.border,
        this.options.sourceFormat,
        this.options.sourceType,
        data,
      );
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this.options.wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, this.options.wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.options.filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.options.filter);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  }
};
Math.isPowerOf2 = function(value) {
  return (value & (value - 1)) === 0;
};

Wugl.Framebuffer = class {
  constructor(context,options) {
    const gl = context.gl;
    this.context = context;
    this.framebuffer = gl.createFramebuffer();
    this.options = {
      attachment: gl.COLOR_ATTACHMENT0
    };
    for (var i in options) this.options[i] = options[i];
  }
  renderToTexture(program,geometry,tex) {
    const gl = this.context.gl;
    program.use();
    geometry.setupRender(program);
    program.setupUniforms();
    program.setupAttributes();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, this.options.attachment, gl.TEXTURE_2D, tex.texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT && tex.options.sourceType === gl.FLOAT) {
      tex.options.sourceType = gl.UNSIGNED_BYTE;
      tex.fillData(null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex.texture, 0);
    }
    geometry.render();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

Wugl.ArrayBuffer = class {
  constructor(context,options) {
    const gl = context.gl;
    this.context = context;
    this.buffer = gl.createBuffer();
    this.length = 3;
    this.data = null;
    this.options = {
      usage: gl.STATIC_DRAW,
      normalize: false,
      stride: 0, 
      offset: 0,
    };
    for (var i in options) this.options[i] = options[i];
  }
  fillData(data,sourceOptions) {
    const gl = this.context.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    this.length = sourceOptions.length || 3;
    this.data = data;
    data = new Float32Array(data);
    gl.bufferData(gl.ARRAY_BUFFER, data, this.options.usage);
  }
  setAttribute(loc) {
    const gl = this.context.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.vertexAttribPointer(loc, this.length, gl.FLOAT, this.options.normalize, this.options.stride, this.options.offset);
  }
}
Wugl.IndexBuffer = class {
  constructor(context,options) {
    const gl = context.gl;
    this.context = context;
    this.buffer = gl.createBuffer();
    this.options = {
      usage: gl.STATIC_DRAW,
    };
    for (var i in options) this.options[i] = options[i];
  }
  fillData(data,sourceOptions) {
    const gl = this.context.gl;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffer);
    this.data = data;
    data = new Uint16Array(data);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, this.options.usage);
  }
}

Wugl.Geometry = class {
  constructor(context) {
    this.context = context;
  }
  setupRender(program) {}
  render() {}
};
Wugl.Geometry.WireframeBox = class extends Wugl.Geometry {
  constructor(context,options) {
    super(context);
    const gl = context.gl;
    var vertices = [
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      1, 1, 0,
      0, 0, 1,
      1, 0, 1,
      0, 1, 1,
      1, 1, 1
    ];
    var indices = [
      0, 1, 1, 3, 3, 2, 2, 0,
      4, 5, 5, 7, 7, 6, 6, 4,
      0, 4, 1, 5, 2, 6, 3, 7
    ];
    this.vertexBuffer = new Wugl.ArrayBuffer(context);
    this.vertexBuffer.fillData(vertices,{length:3});
    this.indexBuffer = new Wugl.IndexBuffer(context);
    this.indexBuffer.fillData(indices);
    this.options = {
      mode: gl.LINES,
      count: 24,
      offset: 0,
      format: gl.UNSIGNED_SHORT,
      vertexLoc: "vertex"
    };
    for (var i in options) this.options[i] = options[i];
  }
  setupRender(program) {
      program.attributes[this.options.vertexLoc] = this.vertexBuffer;
  }
  render() {
    const gl = this.context.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer.buffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer.buffer);
    gl.drawElements(this.options.mode, this.options.count, this.options.format, this.options.offset);
  }
}
Wugl.Geometry.Quad = class extends Wugl.Geometry {
  constructor(context,options) {
    super(context);
    const gl = context.gl;
    var vertices = [
      -1, -1,
      -1, +1,
      +1, -1,
      +1, +1
    ];
    this.vertexBuffer = new Wugl.ArrayBuffer(context);
    this.vertexBuffer.fillData(vertices,{length:2});
    this.options = {
      mode: gl.TRIANGLE_STRIP,
      first: 0,
      count: 4,
      vertexLoc: "vertex"
    };
    for (var i in options) this.options[i] = options[i];
  }
  setupRender(program) {
      program.attributes[this.options.vertexLoc] = this.vertexBuffer;
  }
  render() {
    const gl = this.context.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer.buffer);
    gl.drawArrays(this.options.mode, this.options.first, this.options.count);
  }
}
Wugl.Geometry.Model = class extends Wugl.Geometry {
  constructor(context,model,options) {
    super(context);
    const gl = context.gl;
    if (model.indices) {
      model = Wugl.deindexModel(model);
    }
    this.positionBuffer = new Wugl.ArrayBuffer(context);
    this.positionBuffer.fillData(model.positions,{length:3});
    this.normalBuffer = new Wugl.ArrayBuffer(context);
    this.normalBuffer.fillData(model.normals,{length:3});
    this.texcoordBuffer = new Wugl.ArrayBuffer(context);
    this.texcoordBuffer.fillData(model.texcoords,{length:2});
    this.options = {
      mode: gl.TRIANGLES,
      first: 0,
      count: model.length,
      positionLoc: "a_position",
      normalLoc: "a_normal",
      texcoordLoc: "a_texcoord",
    };
    for (var i in options) this.options[i] = options[i];
  }
  setupRender(program) {
      program.attributes[this.options.positionLoc] = this.positionBuffer;
    program.attributes[this.options.normalLoc] = this.normalBuffer;
    program.attributes[this.options.texcoordLoc] = this.texcoordBuffer;
  }
  render() {
    const gl = this.context.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer.buffer);
    gl.drawArrays(this.options.mode, this.options.first, this.options.count);
  }
}

Wugl.parseObj = function(txt) {
  var model = {
    positions:[],
    texcoords:[],
    normals:[],
    indices:[],
    texcoord_indices:[],
    normal_indices:[],
    colors:[]
  };
  const lines = txt.split("\n");
  for (const line of lines) {
    const normalizedLine = line.trim();
    if(!normalizedLine || normalizedLine.startsWith("#")) continue;
    const parts = normalizedLine.split(/\s+/g);
    var val = parts.slice(1).map(x => parseFloat(x));
    switch(parts[0]) {
      case "v":
        model.positions.push(val[0],val[1],val[2]);
      break;
      case "c":  //custom extension
        model.colors.push(val[0],val[1],val[2]);
      break;
      case "vt": 
        model.texcoords.push(val[0],val[1]);
      break;
      case "vn": 
        model.normals.push(val[0],val[1],val[2]);
      break;
      case "f":
        var num = val.length - 2;
        val = parts.slice(1).map(x => x.split("/").map(o=>parseFloat(o)-1));
        for (let t = 0; t < num; ++t) {
          model.indices.push(val[0][0], val[t+1][0], val[t+2][0]);
          if (!isNaN(val[0][1])) model.texcoord_indices.push(val[0][1], val[t+1][1], val[t+2][1]);
          if (!isNaN(val[0][2])) model.normal_indices.push(val[0][2], val[t+1][2], val[t+2][2]);
        }
      break;
      /*default: 
        throw new Error("Failed to parse: "+parts[0])*/
    }
  }
  return model;
}
Wugl.deindexModel = function(model) {
  var new_model = {
    length: model.indices.length,
    positions:[],
    texcoords:[],
    normals:[],
  };
  for (var i = 0; i < model.indices.length; i++) {
    new_model.positions.push(...model.positions .slice(model.indices[i]*3, model.indices[i]*3+3));
    if (!isNaN(model.texcoord_indices[i])) new_model.texcoords.push(...model.texcoords .slice(model.texcoord_indices[i]*2, model.texcoord_indices[i]*2+2));
    if (!isNaN(model.normal_indices[i])) new_model.normals.push(...model.normals .slice(model.normal_indices[i]*3, model.normal_indices[i]*3+3));
  }
  return new_model;
}

// ----------
//    Math
// ----------

Wugl.Vector = class extends Array {
  constructor() {
      var arr = Array.from(arguments);
    if (arr.length == 1 && typeof arr[0] == "number") {
      arr = new Array(arr[0]).fill(0);
    }
      if (arr[0] instanceof Array && arr[0].length > 1) arr = arr[0];
      super(...arr);
    if (arr[0] instanceof Array && arr[0].length == 1) this[0] = this[0][0];
  }
  get x() {return this[0];}
  get y() {return this[1];}
  get z() {return this[2];}
  get w() {return this[3];}
  e(i) {
    return this[(i+this.length)%this.length];
  }
  copy() {
    return new this.constructor(this);
  }
  get dimensions() {return this.length;}
  dot2() {
    return this.dot(this);
  }
  magnitude() {
    return Math.sqrt(this.dot2());
  }
  get mag() {
    return this.magnitude();
  }
  normalize() {
    var length = this.magnitude();
    if (length == 0) return this;
    return this.divide(length);
  }
  dot(vector) {
    var A = this, B = vector;
    if (A.length !== B.length) throw new Error("Dot product only works on vectors of the same dimensionality: "+A.length+" x "+B.length);
      var sum = 0;
    for (var i = 0; i < A.length; i++) {
      sum += A[i] * B[i];
    }
    return sum;
  }
  cross(vector) {
    var A = this, B = vector;
    if (A.length != 3 || B.length != 3) throw new Error("Cross product only works on vectors of dimensionality 3");
    return new this.constructor([
      (A[1] * B[2]) - (A[2] * B[1]),
      (A[2] * B[0]) - (A[0] * B[2]),
      (A[0] * B[1]) - (A[1] * B[0])
    ]);
  }
  _applyOperation(value,fn) {
      if (!isNaN(value)) {
      return this.map(v=>fn(v,value));
    }
    if (value instanceof Array) {
      if (value.length == this.length) {
        return this.map((v,i)=>fn(v,value[i]));
      }
    }
    throw new Error("Trying to operate on invalid types");
  }
  add(v) {
      return this._applyOperation(v,(a,b)=>a+b);
  }
  multiply(v) {
    if (Wugl.Matrix._validate(v)) {
      return this.toRowMatrix().multiply(v).row(0);
    }
      return this._applyOperation(v,(a,b)=>a*b);
  }
  subtract(v) {
      return this._applyOperation(v,(a,b)=>a-b);
  }
  divide(v) {
      return this._applyOperation(v,(a,b)=>a/b);
  }
  toDiagonalMatrix() {
    return Wugl.Matrix.Diagonal(this);
  }
  toRowMatrix() {
    return new Wugl.Matrix([this]);
  }
  toColumnMatrix() {
    return new Wugl.Matrix(this.map(v=>[v]));
  }
  setElements(arr) {
    if (!this.constructor._validate(arr)) return;
    if (arr.length != this.length) return;
    for (var i = 0; i < this.rows; i++) {
      this[i] = arr[i];
    }
  }
  get elements() {return this;}
  toString() {
    return "["+this.map(v=>v.toFixed(4)).join(",")+"]";
  }
  _validate() {
    return this.constructor._validate(this);
  }
  _snap() {
    return Wugl._snap(this);
  }
};
Wugl.Vector._validate = function(v) {
  if (!(v instanceof Array)) return false;
  for (var i = 0; i < v.length; i++) {
    if (typeof v[i] !== "number") return false;
  }
  return true;
};
Wugl.Vector.Random = function(n) {
  return new this(n).map(Math.random());
};
Wugl.Vector.create = function() {
  return new this(...arguments);
};
Wugl.Vector.force = function(a,s) {
  if (a instanceof this) return a;
  if (typeof a == "number") return new this(s).fill(a);
  if (this._validate(a)) return new this(a);
  return new this(s);
};

Wugl.Color = class extends Wugl.Vector {
  constructor() {
    var arr = Array.from(arguments);
    if (typeof arr[0] == "number") {
      arr = [arr[0]/255,arr[0]/255,arr[0]/255,1];
    }
    if (typeof arr[0] == "string") {
      const elem = document.createElement('div');
      elem.style.color = arr[0];
      document.body.appendChild(elem);
      const computedColor = window.getComputedStyle(elem).color;
      document.body.removeChild(elem);
      arr = computedColor.match(/[\d.]+/g).map(Number);
      arr = [arr[0]/255,arr[1]/255,arr[2]/255,(isNaN(arr[3])?1:arr[3])];
    }
    if (arr[0] instanceof Array) arr = new Array(4).fill(1).map((v,i)=>isNaN(arr[0][i])?v:arr[0][i]);
    arr = arr.map(v=>Math.max(Math.min(v,1),0));
    super(arr);
  }
  get r() {return this[0];}
  get g() {return this[1];}
  get b() {return this[2];}
  get a() {return this[3];}
};
Wugl.Color.force = function(a) {
  return new Wugl.Color(a);
};
Wugl.Color.rgb = function(r,g,b,a) {
  return new Wugl.Color([r/255,g/255,b/255,isNaN(a)?1:(a/100)]);
}
Wugl.Color.hsl = function(h,s,l,a) {
  return new Wugl.Color(`hsla(${h}, ${s}%, ${l}%, ${isNaN(a)?100:a}%)`);
}
Wugl.Color.hsv = function(h,s,v,a) {
  s /= 100; v /= 100;
  var l = v - v * s/2;
  var m = Math.min(l,1-l);
  s = m ? (v-l) / m : 0;
  return Wugl.Color.hsl(h,s*100,l*100,a);
}

Wugl.Matrix = class extends Array {
  constructor() {
      var arr = Array.from(arguments);
    if (arr.length == 1 && typeof arr[0] == "number") {
      arr = new Array(arr[0]).fill(0).map(v=>new Array(arr[0]).fill(0));
    } else if (arr.length == 2 && typeof arr[0] == "number" && typeof arr[1] == "number") {
      arr = new Array(arr[0]).fill(0).map(v=>new Array(arr[1]).fill(0));
    } else if (arr[0] instanceof Array && typeof arr[0][0] != "number") arr = arr[0];
      super(...arr);
  }
  e(i,j) {
    return this[(i+this.rows)%this.rows][(j+this.cols)%this.cols];
  }
  copy() {
    return new this.constructor(super.map(r=>Array.from(r)));
  }
  get rows() {
      return this.length;
  }
  get cols() {
      return this[0].length;
  }
  get dimensions() {
    return [this.rows,this.cols];
  }
  row(i) {
      return new Wugl.Vector(this[i]);
  }
  col(i) {
      return this.transpose().row(i);
  }
  map(fn) {
      return super.map((r,i)=>r.map((v,j)=>fn(v,i,j)))
  }
  some(fn) {
      return super.some((r,i)=>r.some((v,j)=>fn(v,i,j)))
  }
  every(fn) {
      return super.every((r,i)=>r.every((v,j)=>fn(v,i,j)))
  }
  add(value) {
    if (!isNaN(value)) {
      return this.map(v=>v+value);
    }
    if (this.constructor._validate(value)) {
      value = this.constructor.force(value,this.dimensions);
      if (value.rows != this.rows && value.cols == this.cols) {
        return this.map((v,i,j)=>v+value[i][j]);
      }
    }
    throw new Error("Trying to operate on invalid types");
  }
  subtract(value) {
    if (!isNaN(value)) {
      return this.map(v=>v+value);
    }
    if (this.constructor._validate(value)) {
      value = this.constructor.force(value,this.dimensions);
      if (value.rows != this.rows && value.cols == this.cols) {
        return this.map((v,i,j)=>v+value[i][j]);
      }
    }
    throw new Error("Trying to operate on invalid types");
  }
  transpose() {
    var mat = new this.constructor(this.cols,this.rows);
    for (var i = 0; i < this.cols; i++) {
      for (var j = 0; j < this.rows; j++) {
        mat[i][j] = this[j][i];
      }
    }
    return mat;
  }
  get tr() { return this.transpose(); }
  toTriangularPair() {
    // Create copies of the original matrix
    var U = this.copy();
    var L = new this.constructor(this.rows, this.cols).map((_,i,j)=>i==j?1:0);
    
    // Perform elimination while tracking multipliers
    for (var i = 0; i < this.rows; i++) { 
      if (U[i][i] == 0) {
        // Find pivot row
        for (var j = i + 1; j < this.rows; j++) {
          if (U[j][i] != 0) {
            // Store multiplier in L
            L[j][i] = 1;
            // Add rows (instead of swapping)
            U[i] = U[i].map((v, p) => v + U[j][p]);
            break;
          }
        }
      }
      if (U[i][i] != 0) {
        // Track multipliers in L
        for (var j = i + 1; j < this.rows; j++) {
          var multiplier = U[j][i] / U[i][i];
          L[j][i] = multiplier;
          // Eliminate entries below diagonal
          U[j] = U[j].map((v, p) => v - U[i][p] * multiplier);
        }
      }
    }
    
    return { L: L, U: U, R: U };
  }
  toRightTriangular() {
    return this.toTriangularPair().R;
  }
  toUpperTriangular() {
    return this.toTriangularPair().U;
  }
  toLeftTriangular() {
    return this.toTriangularPair().L;
  }
  toLowerTriangular() {
    return this.toTriangularPair().L;
  }
  determinant() {
    if (!this.isSquare()) return null;
    var M = this.toRightTriangular();
    return M.diagonal().reduce((a,v)=>a*v,1);
  }
  get det() { return this.determinant(); }
  isSingular() {
    return (this.isSquare() && this.determinant() === 0);
  }
  rank() {
    var M = this.toRightTriangular();
    var rank = 0;
    for (var i = 0; i < this.rows; i++) {
      for (var j = 0; j < this.cols; j++) {
        if (Math.abs(M[i][j]) > Wugl.precision) { 
          rank++;
          break;
        }
      }
    }
    return rank;
  }
  get rk() { return this.rank(); }
  augment(matrix) {
    if (this.rows !== matrix.rows) return null;
    return new this.constructor(super.map((row, i) => row.concat(matrix[i])));
  }
  inverse() {
    if (!this.isSquare() || this.isSingular()) return null;

    const { L, U } = this.toTriangularPair();

    // Initialize result matrix with identity matrix
    const n = this.rows;
    const inv = new this.constructor(n);
    for (var i = 0; i < n; i++) inv[i][i] = 1;

    // For each column of inverse matrix
    for (let colIdx = 0; colIdx < n; colIdx++) {
      // Forward substitution: Ly = b where b is current column of I
      const y = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        let sumLy = 0;
        for (let k = 0; k < i; k++) {
          sumLy += L[i][k] * y[k];
        }
        y[i] = (inv[i][colIdx] - sumLy) / L[i][i];
      }

      // Back substitution: Ux = y
      const x = new Array(n).fill(0);
      for (let i = n - 1; i >= 0; i--) {
        let sumUx = 0;
        for (let k = i + 1; k < n; k++) {
          sumUx += U[i][k] * x[k];
        }
        x[i] = (y[i] - sumUx) / U[i][i];
      }

      // Set the column in our result matrix
      for (let i = 0; i < n; i++) {
        inv[i][colIdx] = x[i];
      }
    }

    return inv;
  }
  get inv() { return this.inverse(); }
  minor(sr,sc,nr,nc) {
    var mat = new this.constructor(nr,nc);
    return mat.map((_,i,j)=>this.e(i+sr,j+sc));
  }
  multiply(value) {
    if (!isNaN(value)) {
      return this.map(v=>v*value);
    }
    if (Wugl.Vector._validate(value)) {
      value = Wugl.Vector.force(value,this.cols);
      return this.multiply(value.toColumnMatrix()).col(0);
    }
    if (this.constructor._validate(value)) {
      value = this.constructor.force(value);
      if (this.cols != value.rows) return null;
      var product = new this.constructor(this.rows,value.cols);
      var tvalue = value.transpose();
      for (var i = 0; i < this.rows; i++) {
        for (var j = 0; j < tvalue.rows; j++) {
          product[i][j] = this.row(i).dot(tvalue.row(j));
        }
      }
      return product;
    }
  }
  x(value) { return this.multiply(value); }
  isSquare() {
    return (this.rows == this.cols);
  }
  diagonal() {
    if (!this.isSquare()) return null;
    var vec = new Wugl.Vector();
    for (var i = 0; i < this.length; i++) {
      vec[i] = this[i][i];
    }
    return vec;
  }
  setElements(arr) {
    if (!this.constructor._validate(arr)) return;
    if (arr.length != this.rows || arr[0].length != this.cols) return;
    for (var i = 0; i < this.rows; i++) {
      for (var j = 0; j < this.cols; j++) {
        this[i][j] = arr[i][j];
      }
    }
  }
  get elements() {return this;}
  toString() {
    return "[["+super.map(r=>r.map(v=>v.toFixed(4)).join(",")+"]").join(",\n [")+"]";
  }
  _validate() {
    return Wugl.Matrix._validate(this);
  }
  _snap() {
    return Wugl._snap(this);
  }
};
Wugl.Matrix._validate = function(v) {
  if (!(v instanceof Array)) return false;
  if (v.length == 0) return true;
  if (!(v[0] instanceof Array)) return false;
  for (var i = 1; i < v.length; i++) {
    if (!(v[i] instanceof Array)) return false;
    if (v[i].length !== v[0].length) return false;
    for (var j = 0; j < v[i].length; j++) {
      if (typeof v[i][j] !== "number") return false;
    }
  }
  return true;
};
Wugl.Matrix.I = function(size) {
  return this.Diagonal(new Array(size).fill(1));
};
Wugl.Matrix.Random = function(n, m) {
  return new this(n, m).map(Math.random());
};
Wugl.Matrix.Diagonal = function(arr) {
  var mat = new this(arr.length);
  for (var i = 0; i < arr.length; i++) {
    mat[i][i] = arr[i];
  }
  return mat;
};
Wugl.Matrix.create = function() {
  return new this(...arguments);
};
Wugl.Matrix.force = function(a,s) {
  if (a instanceof this) return a;
  if (typeof a == "number") return new this(s).fill(a);
  if (this._validate(a)) return new this(a);
  return new this(s);
};

Wugl._snap = function(v) {
  if (v instanceof Array) return v.map(Wugl._snap);
  var p = Wugl.precision;
  return Math.round(v/p)*p;
}

Wugl.Basis2D = {
  i: new Wugl.Vector([1,0]),
  j: new Wugl.Vector([0,1]),
}
Wugl.Basis3D = {
  i: new Wugl.Vector([1,0,0]),
  j: new Wugl.Vector([0,1,0]),
  k: new Wugl.Vector([0,0,1]),
}

Wugl.Transform = class extends Wugl.Matrix {
  constructor() {
      super(...arguments);
  }
  applyT(m) {
    var T = this;
    T.setElements(T.multiply(m));
    return this;
  }
  rotate() {
    return this.applyT(this.constructor.Rotation(...arguments));
  }
  translate() {
    return this.applyT(this.constructor.Translation(...arguments));
  }
  scale() {
    return this.applyT(this.constructor.Scale(...arguments));
  }
}
Wugl.Transform2D = class extends Wugl.Transform {
  constructor() {
    var arr = Array.from(arguments);
    if (arr.length == 0) arr[0] = Wugl.Matrix.I(3);
      super(...arr);
  }
  applyV(v,w) {
    var T = this;
    var V = new Wugl.Vector([v[0],v[1],isNaN(w)?1:w]);
    return T.multiply(V).slice(0,2);
  }
}
Wugl.Transform2D.Rotation = function(t) {
  var c = Math.cos(t), s = Math.sin(t);
  return new this([
    [ c,-s, 0 ],
    [ s, c, 0 ],
    [ 0, 0, 1 ],
  ]);
};
Wugl.Transform2D.Translation = function(t) {
  t = Wugl.Vector.force(t,2);
  return new this([
    [ 1, 0, t[0] ],
    [ 0, 1, t[1] ],
    [ 0, 0,    1 ]
  ]);
};
Wugl.Transform2D.Scale = function(s) {
  s = Wugl.Vector.force(s,2);
  return new this([
    [ s[0],    0, 0 ],
    [    0, s[1], 0 ],
    [    0,    0, 1 ]
  ]);
};
Wugl.Transform2D.ReflectionX = () => Wugl.Transform2D.Scale([-1,1]);
Wugl.Transform2D.ReflectionY = () => Wugl.Transform2D.Scale([1,-1]);
Wugl.Transform2D.Shear = function(s) {
  return new this([
    [       1, s.yx||0, 0 ],
    [ s.xy||0,       1, 0 ],
    [       0,       0, 1 ]
  ]);
};
Wugl.Transform2D.ShearYX = s => Wugl.Transform2D.Shear({yx:s});
Wugl.Transform2D.ShearXY = s => Wugl.Transform2D.Shear({xy:s});
Wugl.Transform2D.Skew = function(a) {
  return new this([
    [ 1,-a, 0 ],
    [ a, 1, 0 ],
    [ 0, 0, 1 ]
  ]);
};
Wugl.Transform2D.fromBasis = function(i,j) {
  return new this([
    [ i[0], i[1], 0 ],
    [ j[0], j[1], 0 ],
    [    0,    0, 1 ]
  ]);
}

Wugl.Transform3D = class extends Wugl.Transform {
  constructor() {
    var arr = Array.from(arguments);
    if (arr.length == 0) arr[0] = Wugl.Matrix.I(4);
      super(...arr);
  }
  applyV(v,w) {
    var T = this;
    var V = new Wugl.Vector([v[0],v[1],v[2],isNaN(w)?1:w]).toColumnMatrix();
    return T.multiply(V).col(0).slice(0,3);
  }
  rotateX() {
    return this.applyT(this.constructor.RotationX(...arguments));
  }
  rotateY() {
    return this.applyT(this.constructor.RotationY(...arguments));
  }
  rotateZ() {
    return this.applyT(this.constructor.RotationZ(...arguments));
  }
}
Wugl.Transform3D.RotationX = function(t) {
  var c = Math.cos(t), s = Math.sin(t);
  return new this([
    [ 1, 0, 0, 0 ],
    [ 0, c,-s, 0 ],
    [ 0, s, c, 0 ],
    [ 0, 0, 0, 1 ]
  ]);
};
Wugl.Transform3D.RotationY = function(t) {
  var c = Math.cos(t), s = Math.sin(t);
  return new this([
    [ c, 0, s, 0 ],
    [ 0, 1, 0, 0 ],
    [-s, 0, c, 0 ],
    [ 0, 0, 0, 1 ]
  ]);
};
Wugl.Transform3D.RotationZ = function(t) {
  var c = Math.cos(t), s = Math.sin(t);
  return new this([
    [ c,-s, 0, 0 ],
    [ s, c, 0, 0 ],
    [ 0, 0, 1, 0 ],
    [ 0, 0, 0, 1 ]
  ]);
};
Wugl.Transform3D.Rotation = function(theta, a) {
  a = Wugl.Vector.force(a,3);
  var axis = a.copy();
  if (axis.length != 3) return null;
  var mod = axis.modulus();
  var x = axis[0]/mod, y = axis[1]/mod, z = axis[2]/mod;
  var s = Math.sin(theta), c = Math.cos(theta), t = 1 - c;
  // Formula derived here: http://www.gamedev.net/reference/articles/article1199.asp
  // That proof rotates the co-ordinate system so theta
  // becomes -theta and sin becomes -sin here.
  return new this([
    [   t*x*x + c, t*x*y - s*z, t*x*z + s*y, 0 ],
    [ t*x*y + s*z,   t*y*y + c, t*y*z - s*x, 0 ],
    [ t*x*z - s*y, t*y*z + s*x,   t*z*z + c, 0 ],
    [           0,           0,           0, 1 ]
  ]);
};
Wugl.Transform3D.Translation = function(t) {
  t = Wugl.Vector.force(t,3);
  return new this([
    [ 1, 0, 0, t[0] ],
    [ 0, 1, 0, t[1] ],
    [ 0, 0, 1, t[2] ],
    [ 0, 0, 0,    1 ]
  ]);
};
Wugl.Transform3D.Scale = function(s) {
  s = Wugl.Vector.force(s,3);
  return new this([
    [ s[0],    0,    0, 0 ],
    [    0, s[1],    0, 0 ],
    [    0,    0, s[2], 0 ],
    [    0,    0,    0, 1 ]
  ]);
};
Wugl.Transform3D.ReflectionX = () => Wugl.Transform3D.Scale([-1,1,1]);
Wugl.Transform3D.ReflectionY = () => Wugl.Transform3D.Scale([1,-1,1]);
Wugl.Transform3D.ReflectionZ = () => Wugl.Transform3D.Scale([1,1,-1]);
Wugl.Transform3D.Shear = function(s) {
  return new this([
    [       1, s.yx||0, s.zx||0, 0 ],
    [ s.xy||0,       1, s.zy||0, 0 ],
    [ s.xz||0, s.yz||0,       1, 0 ],
    [       0,       0,       0, 1 ]
  ]);
};
Wugl.Transform3D.ShearYX = s => Wugl.Transform3D.Shear({yx:s});
Wugl.Transform3D.ShearZX = s => Wugl.Transform3D.Shear({zx:s});
Wugl.Transform3D.ShearXY = s => Wugl.Transform3D.Shear({xy:s});
Wugl.Transform3D.ShearZY = s => Wugl.Transform3D.Shear({zy:s});
Wugl.Transform3D.ShearXZ = s => Wugl.Transform3D.Shear({xz:s});
Wugl.Transform3D.ShearYZ = s => Wugl.Transform3D.Shear({yz:s});
Wugl.Transform3D.Skew = function(a) {
  a = Wugl.Vector.force(a,3);
  return new this([
    [    1,-a[2], a[1], 0 ],
    [ a[2],    1,-a[0], 0 ],
    [-a[1], a[0],    1, 0 ],
    [    0,    0,    0, 1 ]
  ]);
};
Wugl.Transform3D.fromBasis = function(i,j,k) {
  return new this([
    [ i[0], i[1], i[2], 0 ],
    [ j[0], j[1], j[2], 0 ],
    [ k[0], k[1], k[2], 0 ],
    [    0,    0,    0, 1 ]
  ]);
}

Wugl.makeLookAt = function(eye,center,up) {
  eye = Wugl.Vector.force(eye,3);
  center = Wugl.Vector.force(center,3);
  up = up?Wugl.Vector.force(up,3):Wugl.Basis3D.j;

  var mag;

  var z = eye.subtract(center).normalize();
  var x = up.cross(z).normalize();
  var y = z.cross(x).normalize();

  var m = Wugl.Transform3D.fromBasis(x,y,z);
  var t = Wugl.Transform3D.Translation(eye.map(v=>-v));
  
  return m.multiply(t);
}
Wugl.makeOrtho = function(left, right, bottom, top, znear, zfar) {
  var tx = -(right+left)/(right-left);
  var ty = -(top+bottom)/(top-bottom);
  var tz = -(zfar+znear)/(zfar-znear);
  return new Wugl.Transform3D([
    [2/(right-left), 0, 0, tx],
    [0, 2/(top-bottom), 0, ty],
    [0, 0, -2/(zfar-znear), tz],
    [0, 0, 0, 1]
  ]);
}
Wugl.makePerspective = function(fovy, aspect, znear, zfar) {
  var ymax = znear * Math.tan(fovy * Math.PI / 360.0);
  var ymin = -ymax;
  var xmin = ymin * aspect;
  var xmax = ymax * aspect;
  return Wugl.makeFrustum(xmin, xmax, ymin, ymax, znear, zfar);
}
Wugl.makeFrustum = function(left, right, bottom, top, znear, zfar) {
  var X = 2*znear/(right-left);
  var Y = 2*znear/(top-bottom);
  var A = (right+left)/(right-left);
  var B = (top+bottom)/(top-bottom);
  var C = -(zfar+znear)/(zfar-znear);
  var D = -2*zfar*znear/(zfar-znear);

  return new Wugl.Transform3D([
    [X, 0, A, 0],
    [0, Y, B, 0],
    [0, 0, C, D],
    [0, 0,-1, 0]
  ]);
}
