// based on tdl.example.example.html

tdl.require('tdl.buffers');
tdl.require('tdl.fast');
tdl.require('tdl.fps');
tdl.require('tdl.log');
tdl.require('tdl.math');
tdl.require('tdl.framebuffers');
tdl.require('tdl.models');
tdl.require('tdl.primitives');
tdl.require('tdl.programs');
tdl.require('tdl.textures');
tdl.require('tdl.webgl');
window.onload = initialize;

// globals
var gl;                   // the gl context.
var canvas;               // the canvas
var mainFbo;
var secFbo;
var lastFbo;
var math;                 // the math lib.
var fast;                 // the fast math lib.
var g_fpsTimer;           // object to measure frames per second;
var g_logGLCalls = true;  // whether or not to log webgl calls
var g_debug = false;      // whether or not to debug.
var g_drawOnce = false;   // draw just one frame.

var g_eyeSpeed  = 0.2;
var g_eyeHeight = 2;
var g_eyeRadius = 9;
var g_velocityScale = 60.0; // velocity shall ~ match fps
var g_samples = 14.0;

function ValidateNoneOfTheArgsAreUndefined(functionName, args) {
  for (var ii = 0; ii < args.length; ++ii) {
    if (args[ii] === undefined) {
      tdl.error("undefined passed to gl." + functionName + "(" +
                tdl.webgl.glFunctionArgsToString(functionName, args) + ")");
    }
  }
}

function Log(msg) {
  if (g_logGLCalls) {
    tdl.log(msg);
  }
}

function LogGLCall(functionName, args) {
  if (g_logGLCalls) {
    ValidateNoneOfTheArgsAreUndefined(functionName, args)
    tdl.log("gl." + functionName + "(" +
                tdl.webgl.glFunctionArgsToString(functionName, args) + ")");
  }
}

// Function to load shader programs as files by uri.
// JQuery HttpRequest
function createProgramFromTags(vertexTagId, fragmentTagId) {
	// http://stackoverflow.com/questions/4878145/javascript-and-webgl-external-scripts
		var vs_source = null,
        fs_source = null;
	$.ajax({
	    async: false,
	    url: vertexTagId,
	    success: function (data) {
	    	vs_source = data;
	    },
	    dataType: 'html' // HTML for the correct encoding of ampersand so.
	});

	$.ajax({
	    async: false,
	    url: fragmentTagId,
	    success: function (data) {
	    	fs_source = data;
	    },
	    dataType: 'html'
	});
  return tdl.programs.loadProgram(vs_source, fs_source);
}

/**
 * Sets up Planet.
 */
function setupSphere() {
  var textures = {
    diffuseSampler: tdl.textures.loadTexture('../tdl/example/assets/sometexture.png')
  };
  var program = createProgramFromTags(
      './shaders/sphere.vs',
      './shaders/sphere.fs');
  var arrays = tdl.primitives.createSphere(0.4, 10, 12);
  
  return new tdl.models.Model(program, arrays, textures);
}

/**
 * Sets up cube which takes textures and applies post processing. 
 */
function setupTextureCube(texture, depthTexture) {
  var textures = {
      texture: texture,
      depthTexture: depthTexture
  };
  var program = createProgramFromTags(
    './shaders/main.vs',
    './shaders/main.fs');
  // create plane size 2x2 with 1x1 subdivie
  var arrays = tdl.primitives.createCube(2);
  delete arrays.normal;
  return new tdl.models.Model(program, arrays, textures);
}


function initialize() {
  math = tdl.math;
  fast = tdl.fast;
  canvas = document.getElementById("canvas");

  g_fpsTimer = new tdl.fps.FPSTimer();

  gl = tdl.webgl.setupWebGL(canvas);
  if (!gl) {
    return false;
  }
  if (g_debug) {
    gl = tdl.webgl.makeDebugContext(gl, undefined, LogGLCall);
  }
  

  // Initialize our render target for the scene without post processing.
  lastFbo = tdl.framebuffers.createFramebuffer(canvas.width, canvas.height, true);
  // Create the cube as plane for our texture, no scaling or rotation is futher needed.
  var textureCube = setupTextureCube(lastFbo.texture, lastFbo.depthTexture);

  Log("--Setup Sphere---------------------------------------");
  var sphere = setupSphere();

  var then = 0.0;
  var clock = 0.0;
  var fpsElem = document.getElementById("fps");

  // pre-allocate a bunch of arrays
  var projection = new Float32Array(16);
  var view = new Float32Array(16);
  var world = new Float32Array(16);
  var worldInverse = new Float32Array(16);
  var worldInverseTranspose = new Float32Array(16);
  var viewProjection = new Float32Array(16);
  var previousViewProjection = new Float32Array(16);
  var worldViewProjection = new Float32Array(16);
  var viewInverse = new Float32Array(16);
  var viewProjectionInverse = new Float32Array(16);
  var eyePosition = new Float32Array(3);
  var target = new Float32Array(3);
  var up = new Float32Array([0,1,0]);
  var lightWorldPos = new Float32Array(3);
  var v3t0 = new Float32Array(3);
  var v3t1 = new Float32Array(3);
  var v3t2 = new Float32Array(3);
  var v3t3 = new Float32Array(3);
  var m4t0 = new Float32Array(16);
  var m4t1 = new Float32Array(16);
  var m4t2 = new Float32Array(16);
  var m4t3 = new Float32Array(16);
  var zero4 = new Float32Array(4);
  var one4 = new Float32Array([1,1,1,1]);

  // Sphere uniforms.
  var sphereConst = {
    viewInverse: viewInverse,
    lightWorldPos: lightWorldPos,
    specular: one4,
    shininess: 50,
    specularFactor: 0.2};

  var spherePer = {
    lightColor: new Float32Array([0,0,0,1]),
    world: world,
    worldViewProjection: worldViewProjection,
    worldInverse: worldInverse,
    worldInverseTranspose: worldInverseTranspose};

var blurConst = {
      viewProjection: viewProjection,
      viewProjectionInverse: viewProjectionInverse,
      previousViewProjection: previousViewProjection
      
    };
    

  var frameCount = 0;

  function render() {
    ++frameCount;
    if (!g_drawOnce) {
      tdl.webgl.requestAnimationFrame(render, canvas);
    }
    var now = (new Date()).getTime() * 0.001;
    var elapsedTime;
    if(then == 0.0) {
      elapsedTime = 0.0;
    } else {
      elapsedTime = now - then;
    }
    then = now;

    g_fpsTimer.update(elapsedTime);
    fpsElem.innerHTML = g_fpsTimer.averageFPS;

    clock += elapsedTime;
    
    eyePosition[0] = Math.sin(clock * g_eyeSpeed) * g_eyeRadius;
    eyePosition[1] = g_eyeHeight;
    eyePosition[2] = Math.cos(clock * g_eyeSpeed) * g_eyeRadius;
    
    lastFbo.bind();  
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);

    // Scene Background Color cleared to black.
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    gl.enable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);

    fast.matrix4.perspective(
        projection,
        math.degToRad(60),
        canvas.clientWidth / canvas.clientHeight,
        1,
        5000);

    fast.matrix4.lookAt(
        view,
        eyePosition,
        target,
        up);

    fast.matrix4.mul(viewProjection, view, projection);
    fast.matrix4.inverse(viewInverse, view);
    fast.matrix4.inverse(viewProjectionInverse, viewProjection);
    // first frame the previous matrix is empty 
    
    fast.matrix4.getAxis(v3t0, viewInverse, 0); // x
    fast.matrix4.getAxis(v3t1, viewInverse, 1); // y;
    fast.matrix4.getAxis(v3t2, viewInverse, 2); // z;
    fast.mulScalarVector(v3t0, 10, v3t0);
    fast.mulScalarVector(v3t1, 10, v3t1);
    fast.mulScalarVector(v3t2, 10, v3t2);
    fast.addVector(lightWorldPos, eyePosition, v3t0);
    fast.addVector(lightWorldPos, lightWorldPos, v3t1);
    fast.addVector(lightWorldPos, lightWorldPos, v3t2);

    Log("--Draw sphere---------------------------------------");
    sphere.drawPrep(sphereConst);
    
    var across = 6;
    var lightColor = spherePer.lightColor;
    var half = (across - 1) * 0.5;
    for (var xx = 0; xx < across; ++xx) {
      for (var yy = 0; yy < across; ++yy) {
        for (var zz = 0; zz < across; ++zz) {
          lightColor[0] = xx / across;
          lightColor[1] = yy / across;
          lightColor[2] = zz / across;
          var scale = (xx + yy + zz) % 4 / 4 + 0.5;
          fast.matrix4.scaling(m4t0, [scale, scale, scale]);
          fast.matrix4.translation(m4t1, [xx - half, yy - half, zz - half]);
          fast.matrix4.mul(world, m4t0, m4t1);
          fast.matrix4.mul(worldViewProjection, world, viewProjection);
          fast.matrix4.inverse(worldInverse, world);
          fast.matrix4.transpose(worldInverseTranspose, worldInverse);
          sphere.draw(spherePer);
        }
      }
    }

    // Stop draw to Frame Buffer Objekt we going back to Backbuffer.
    lastFbo.unbind();
    
     // http://www.opengl.org/sdk/docs/man/xhtml/glClearColor.xml
    // specified black to be used by gl.clear
    gl.clearColor(0,0.75,0,0);
    // http://www.opengl.org/sdk/docs/man/xhtml/glClearDepth.xml
    // Specifies the depth value used by glClear to clear the depth buffer.
    // Values specified by glClearDepth are clamped to the range 0 1 .
    gl.clearDepth(1);
    // Specifies whether the depth buffer is enabled for writing.
    // If flag is GL_FALSE, depth buffer writing is disabled.
    // Otherwise, it is enabled. Initially, depth buffer writing is enabled.
    gl.depthMask(true);
    gl.colorMask(true, true, true, true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    
    
    textureCube.drawPrep(blurConst);
    textureCube.draw({velocityScale: g_velocityScale, samples: g_samples});

    // turn off logging after 1 frame.
    g_logGLCalls = false;

    fast.matrix4.copy(previousViewProjection, viewProjection);

  }

  render();
  return true;
}