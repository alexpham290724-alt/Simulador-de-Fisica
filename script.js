// Configuración inicial
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f172a);
scene.fog = new THREE.Fog(0x0f172a, 20, 100);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(15, 12, 15);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('canvas-container').appendChild(renderer.domElement);

// Controles de cámara
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2;

// Iluminación
const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(10, 20, 10);
directionalLight.castShadow = true;
directionalLight.shadow.camera.left = -20;
directionalLight.shadow.camera.right = 20;
directionalLight.shadow.camera.top = 20;
directionalLight.shadow.camera.bottom = -20;
scene.add(directionalLight);

// Grid y ejes
const gridHelper = new THREE.GridHelper(40, 40, 0x3b82f6, 0x1e293b);
scene.add(gridHelper);

const axesHelper = new THREE.AxesHelper(5);
scene.add(axesHelper);

// Suelo invisible para colisiones visuales
const planeGeometry = new THREE.PlaneGeometry(40, 40);
const planeMaterial = new THREE.MeshBasicMaterial({ visible: false });
const plane = new THREE.Mesh(planeGeometry, planeMaterial);
plane.rotation.x = -Math.PI / 2;
plane.position.y = -0.01;
scene.add(plane);

// Variables del objeto físico
let mass = 10;
let velocity = new THREE.Vector3(0, 0, 0);
let acceleration = new THREE.Vector3(0, 0, 0);
let forces = new THREE.Vector3(0, 0, 0);
let position = new THREE.Vector3(0, 5, 0);
let friction = 0.1;
let gravity = -9.8;
let isPaused = false;
let objectColor = 0xe74c3c;
let trail = [];
const maxTrailLength = 100;

// Crear objeto principal (esfera)
const geometry = new THREE.SphereGeometry(1, 32, 32);
const material = new THREE.MeshPhongMaterial({ 
    color: objectColor,
    shininess: 100,
    specular: 0x444444
});
const sphere = new THREE.Mesh(geometry, material);
sphere.castShadow = true;
sphere.receiveShadow = true;
sphere.position.copy(position);
scene.add(sphere);

// Vectores visuales
const vectorGroup = new THREE.Group();
scene.add(vectorGroup);

// Función para crear flechas
function createArrow(color, name) {
    const dir = new THREE.Vector3(1, 0, 0);
    const origin = new THREE.Vector3(0, 0, 0);
    const length = 1;
    const hex = color;
    const arrowHelper = new THREE.ArrowHelper(dir, origin, length, hex, 0.3, 0.2);
    arrowHelper.name = name;
    return arrowHelper;
}

const forceArrow = createArrow(0xe74c3c, 'force');
const velocityArrow = createArrow(0x3498db, 'velocity');
const accelerationArrow = createArrow(0x2ecc71, 'acceleration');

vectorGroup.add(forceArrow);
vectorGroup.add(velocityArrow);
vectorGroup.add(accelerationArrow);

// Trayectoria
const trailGeometry = new THREE.BufferGeometry();
const trailMaterial = new THREE.LineBasicMaterial({ 
    color: 0x60a5fa, 
    opacity: 0.5, 
    transparent: true,
    linewidth: 2
});
const trailLine = new THREE.Line(trailGeometry, trailMaterial);
scene.add(trailLine);

// Funciones de física
function updatePhysics(deltaTime) {
    if (isPaused) return;

    // Fuerza de gravedad
    const gravityForce = new THREE.Vector3(0, gravity * mass, 0);
    
    // Fuerza de fricción (proporcional a la velocidad, opuesta a ella)
    const frictionForce = velocity.clone().multiplyScalar(-friction * mass * 2);
    
    // Fuerza total
    const totalForce = new THREE.Vector3()
        .add(forces)
        .add(gravityForce)
        .add(frictionForce);
    
    // Segunda ley de Newton: F = ma -> a = F/m
    acceleration.copy(totalForce.divideScalar(mass));
    
    // Integración de Euler para velocidad y posición
    velocity.add(acceleration.clone().multiplyScalar(deltaTime));
    position.add(velocity.clone().multiplyScalar(deltaTime));
    
    // Colisión con el suelo
    if (position.y < 1) {
        position.y = 1;
        velocity.y *= -0.7; // Restitución (rebote)
        
        // Fricción en el suelo
        velocity.x *= 0.95;
        velocity.z *= 0.95;
        
        // Detener si la velocidad es muy pequeña
        if (Math.abs(velocity.y) < 0.1) velocity.y = 0;
    }
    
    // Límites del mundo (paredes invisibles)
    const limit = 19;
    if (Math.abs(position.x) > limit) {
        position.x = Math.sign(position.x) * limit;
        velocity.x *= -0.7;
    }
    if (Math.abs(position.z) > limit) {
        position.z = Math.sign(position.z) * limit;
        velocity.z *= -0.7;
    }
    
    // Actualizar posición de la esfera
    sphere.position.copy(position);
    
    // Actualizar trail
    if (document.getElementById('show-trail').checked) {
        trail.push(position.clone());
        if (trail.length > maxTrailLength) trail.shift();
        updateTrail();
    }
    
    // Actualizar vectores visuales
    updateVectors();
    
    // Actualizar UI
    updateUI();
}

function updateVectors() {
    const showVectors = document.getElementById('show-vectors').checked;
    vectorGroup.visible = showVectors;
    
    if (!showVectors) return;
    
    // Posición base para los vectores (encima de la esfera)
    const basePos = position.clone().add(new THREE.Vector3(0, 1.5, 0));
    
    // Vector de fuerza (escalado para visualización)
    const forceMag = forces.length();
    if (forceMag > 0.1) {
        forceArrow.visible = true;
        forceArrow.position.copy(basePos);
        forceArrow.setDirection(forces.clone().normalize());
        forceArrow.setLength(Math.min(forceMag / 10, 5), 0.3, 0.2);
    } else {
        forceArrow.visible = false;
    }
    
    // Vector de velocidad
    const velMag = velocity.length();
    if (velMag > 0.1) {
        velocityArrow.visible = true;
        velocityArrow.position.copy(basePos);
        velocityArrow.setDirection(velocity.clone().normalize());
        velocityArrow.setLength(Math.min(velMag, 5), 0.3, 0.2);
    } else {
        velocityArrow.visible = false;
    }
    
    // Vector de aceleración
    const accMag = acceleration.length();
    if (accMag > 0.1) {
        accelerationArrow.visible = true;
        accelerationArrow.position.copy(basePos);
        accelerationArrow.setDirection(acceleration.clone().normalize());
        accelerationArrow.setLength(Math.min(accMag * 2, 5), 0.3, 0.2);
    } else {
        accelerationArrow.visible = false;
    }
}

function updateTrail() {
    if (trail.length < 2) return;
    const positions = new Float32Array(trail.length * 3);
    for (let i = 0; i < trail.length; i++) {
        positions[i * 3] = trail[i].x;
        positions[i * 3 + 1] = trail[i].y;
        positions[i * 3 + 2] = trail[i].z;
    }
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    trailGeometry.attributes.position.needsUpdate = true;
}

function updateUI() {
    // Velocidad
    const v = velocity.length();
    document.getElementById('velocity-display').textContent = v.toFixed(2) + ' m/s';
    document.getElementById('vx').textContent = velocity.x.toFixed(2);
    document.getElementById('vy').textContent = velocity.y.toFixed(2);
    document.getElementById('vz').textContent = velocity.z.toFixed(2);
    
    // Aceleración
    const a = acceleration.length();
    document.getElementById('acceleration-display').textContent = a.toFixed(2) + ' m/s²';
    document.getElementById('ax').textContent = acceleration.x.toFixed(2);
    document.getElementById('ay').textContent = acceleration.y.toFixed(2);
    document.getElementById('az').textContent = acceleration.z.toFixed(2);
    
    // Energía cinética: Ec = 1/2 * m * v²
    const ke = 0.5 * mass * v * v;
    document.getElementById('kinetic-energy').textContent = ke.toFixed(2) + ' J';
    
    // Momento lineal: p = m * v
    const p = mass * v;
    document.getElementById('momentum').textContent = p.toFixed(2) + ' kg·m/s';
    
    // Posición
    document.getElementById('pos-x').textContent = position.x.toFixed(2);
    document.getElementById('pos-y').textContent = position.y.toFixed(2);
    document.getElementById('pos-z').textContent = position.z.toFixed(2);
}

// Event Listeners
document.getElementById('mass').addEventListener('input', (e) => {
    mass = parseFloat(e.target.value);
    document.getElementById('mass-value').textContent = mass + ' kg';
    // Escalar visualmente la esfera según la masa
    const scale = 0.5 + (mass / 50) * 1.5;
    sphere.scale.set(scale, scale, scale);
});

document.getElementById('forceX').addEventListener('input', (e) => {
    document.getElementById('forceX-value').textContent = e.target.value + ' N';
});

document.getElementById('forceY').addEventListener('input', (e) => {
    document.getElementById('forceY-value').textContent = e.target.value + ' N';
});

document.getElementById('forceZ').addEventListener('input', (e) => {
    document.getElementById('forceZ-value').textContent = e.target.value + ' N';
});

document.getElementById('apply-force').addEventListener('click', () => {
    const fx = parseFloat(document.getElementById('forceX').value);
    const fy = parseFloat(document.getElementById('forceY').value);
    const fz = parseFloat(document.getElementById('forceZ').value);
    forces.set(fx, fy, fz);
});

document.getElementById('reset-forces').addEventListener('click', () => {
    forces.set(0, 0, 0);
    document.getElementById('forceX').value = 0;
    document.getElementById('forceY').value = 0;
    document.getElementById('forceZ').value = 0;
    document.getElementById('forceX-value').textContent = '0 N';
    document.getElementById('forceY-value').textContent = '0 N';
    document.getElementById('forceZ-value').textContent = '0 N';
});

document.getElementById('friction').addEventListener('input', (e) => {
    friction = parseFloat(e.target.value);
    document.getElementById('friction-value').textContent = friction.toFixed(2);
});

document.getElementById('gravity').addEventListener('input', (e) => {
    gravity = parseFloat(e.target.value);
    document.getElementById('gravity-value').textContent = gravity.toFixed(1) + ' m/s²';
});

document.getElementById('play-pause').addEventListener('click', (e) => {
    isPaused = !isPaused;
    e.target.textContent = isPaused ? '▶ Reanudar' : '⏸ Pausar';
    e.target.classList.toggle('btn-primary');
    e.target.classList.toggle('btn-secondary');
});

document.getElementById('reset-scene').addEventListener('click', () => {
    position.set(0, 5, 0);
    velocity.set(0, 0, 0);
    acceleration.set(0, 0, 0);
    forces.set(0, 0, 0);
    trail = [];
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    sphere.position.copy(position);
    sphere.rotation.set(0, 0, 0);
    
    // Resetear inputs
    document.getElementById('forceX').value = 0;
    document.getElementById('forceY').value = 0;
    document.getElementById('forceZ').value = 0;
    document.getElementById('forceX-value').textContent = '0 N';
    document.getElementById('forceY-value').textContent = '0 N';
    document.getElementById('forceZ-value').textContent = '0 N';
    
    updateUI();
});

// Color picker
document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        objectColor = parseInt(btn.dataset.color.replace('#', '0x'));
        sphere.material.color.setHex(objectColor);
    });
});

// Resize handler
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Loop de animación
let lastTime = 0;
function animate(currentTime) {
    requestAnimationFrame(animate);
    
    const deltaTime = Math.min((currentTime - lastTime) / 1000, 0.1);
    lastTime = currentTime;
    
    if (deltaTime > 0) {
        updatePhysics(deltaTime);
    }
    
    // Rotar la esfera según la velocidad angular (simulado)
    if (!isPaused && velocity.length() > 0.1) {
        sphere.rotation.x += velocity.z * deltaTime * 0.5;
        sphere.rotation.z -= velocity.x * deltaTime * 0.5;
    }
    
    controls.update();
    renderer.render(scene, camera);
}

animate(0);