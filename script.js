/**
 * Simulador de Física 3D — Motor Newtoniano Avanzado
 * Arquitectura modular con integración semi-implicita de Euler,
 * fricción de Coulomb, arrastre aerodinámico y pooling de buffers.
 */

class PhysicsSimulator {
    constructor() {
        // Three.js core
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.clock = new THREE.Clock();

        // Estado físico (SI)
        this.mass = 10.0;           // kg
        this.radius = 1.0;          // m
        this.position = new THREE.Vector3(0, 5, 0);
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.acceleration = new THREE.Vector3(0, 0, 0);
        this.appliedForce = new THREE.Vector3(0, 0, 0); // Fuerza externa del usuario

        // Parámetros ambientales
        this.gravity = -9.8;        // m/s²
        this.frictionCoeff = 0.3;   // μ (Coulomb)
        this.restitution = 0.7;     // e (coef. restitución)
        this.airDensity = 1.225;    // kg/m³
        this.dragCoeff = 0.47;      // Esfera lisa

        // Estado de simulación
        this.isPaused = false;
        this.isGrounded = false;
        this.timeScale = 1.0;
        this.objectColor = 0xe74c3c;

        // Optimización UI
        this.uiAccumulator = 0;
        this.uiInterval = 0.08;     // ~12 Hz para el DOM

        // Trail optimizado (buffer pre-allocado)
        this.maxTrailLength = 250;
        this.trailIndex = 0;
        this.trailCount = 0;
        this.trailPositions = new Float32Array(this.maxTrailLength * 3);
        this.trailGeometry = new THREE.BufferGeometry();
        this.trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
        this.trailGeometry.setDrawRange(0, 0);

        // Fuerzas calculadas para desglose
        this.lastForces = {
            gravity: 0, normal: 0, friction: 0, drag: 0, applied: 0
        };

        this.init();
    }

    /* ───────────────────── INICIALIZACIÓN ───────────────────── */

    init() {
        this.setupRenderer();
        this.setupScene();
        this.setupLighting();
        this.setupEnvironment();
        this.setupObject();
        this.setupVectors();
        this.setupTrail();
        this.setupEvents();
        this.animate();
    }

    setupRenderer() {
        const container = document.getElementById('canvas-container');

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0b0f19);
        this.scene.fog = new THREE.FogExp2(0x0b0f19, 0.015);

        this.camera = new THREE.PerspectiveCamera(
            60, window.innerWidth / window.innerHeight, 0.1, 500
        );
        this.camera.position.set(12, 10, 12);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;
        container.appendChild(this.renderer.domElement);

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.02; // Evitar ir bajo el suelo
        this.controls.minDistance = 3;
        this.controls.maxDistance = 60;
        this.controls.target.copy(this.position);
    }

    setupScene() {
        // Grid principal con coordenadas implícitas
        const grid = new THREE.GridHelper(60, 60, 0x3b82f6, 0x1e293b);
        grid.material.opacity = 0.3;
        grid.material.transparent = true;
        this.scene.add(grid);

        // Ejes locales
        const axes = new THREE.AxesHelper(3);
        axes.position.set(-19, 0.01, -19);
        this.scene.add(axes);

        // Suelo reflectivo sutil
        const planeGeo = new THREE.PlaneGeometry(200, 200);
        const planeMat = new THREE.MeshStandardMaterial({
            color: 0x0f172a,
            roughness: 0.9,
            metalness: 0.1
        });
        const plane = new THREE.Mesh(planeGeo, planeMat);
        plane.rotation.x = -Math.PI / 2;
        plane.position.y = -0.005;
        plane.receiveShadow = true;
        this.scene.add(plane);
    }

    setupLighting() {
        const ambient = new THREE.AmbientLight(0x64748b, 0.5);
        this.scene.add(ambient);

        const hemi = new THREE.HemisphereLight(0x60a5fa, 0x1e293b, 0.4);
        this.scene.add(hemi);

        const dir = new THREE.DirectionalLight(0xffffff, 1.2);
        dir.position.set(15, 25, 10);
        dir.castShadow = true;
        dir.shadow.mapSize.width = 2048;
        dir.shadow.mapSize.height = 2048;
        dir.shadow.camera.near = 0.5;
        dir.shadow.camera.far = 100;
        dir.shadow.camera.left = -30;
        dir.shadow.camera.right = 30;
        dir.shadow.camera.top = 30;
        dir.shadow.camera.bottom = -30;
        dir.shadow.bias = -0.0005;
        this.scene.add(dir);

        // Luz de relleno cálida
        const fill = new THREE.DirectionalLight(0xf59e0b, 0.3);
        fill.position.set(-10, 5, -10);
        this.scene.add(fill);
    }

    setupEnvironment() {
        // Marcas de escala en el suelo (anillos concéntricos sutiles)
        for (let r = 5; r <= 20; r += 5) {
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(r - 0.02, r + 0.02, 64),
                new THREE.MeshBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.y = 0.002;
            this.scene.add(ring);
        }
    }

    setupObject() {
        const geometry = new THREE.SphereGeometry(1, 64, 64);
        const material = new THREE.MeshStandardMaterial({
            color: this.objectColor,
            roughness: 0.4,
            metalness: 0.3,
            envMapIntensity: 1.0
        });
        this.sphere = new THREE.Mesh(geometry, material);
        this.sphere.castShadow = true;
        this.sphere.receiveShadow = true;
        this.sphere.position.copy(this.position);
        this.scene.add(this.sphere);

        // Halo de contacto (indicador visual de proximidad al suelo)
        this.contactRing = new THREE.Mesh(
            new THREE.RingGeometry(0.8, 1.0, 32),
            new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0, side: THREE.DoubleSide })
        );
        this.contactRing.rotation.x = -Math.PI / 2;
        this.scene.add(this.contactRing);
    }

    setupVectors() {
        this.vectorGroup = new THREE.Group();
        this.scene.add(this.vectorGroup);

        const createArrow = (color, name) => {
            const ah = new THREE.ArrowHelper(
                new THREE.Vector3(1, 0, 0),
                new THREE.Vector3(0, 0, 0),
                1, color, 0.25, 0.18
            );
            ah.name = name;
            return ah;
        };

        this.forceArrow = createArrow(0xe74c3c, 'force');
        this.velocityArrow = createArrow(0x3498db, 'velocity');
        this.accelerationArrow = createArrow(0x2ecc71, 'acceleration');
        this.dragArrow = createArrow(0xf39c12, 'drag');

        this.vectorGroup.add(this.forceArrow);
        this.vectorGroup.add(this.velocityArrow);
        this.vectorGroup.add(this.accelerationArrow);
        this.vectorGroup.add(this.dragArrow);
    }

    setupTrail() {
        this.trailLine = new THREE.Line(
            this.trailGeometry,
            new THREE.LineBasicMaterial({
                color: 0x60a5fa,
                opacity: 0.6,
                transparent: true,
                linewidth: 1
            })
        );
        this.scene.add(this.trailLine);
    }

    /* ───────────────────── FÍSICA ───────────────────── */

    updatePhysics(rawDt) {
        if (this.isPaused) return;

        // Sub-stepping para estabilidad con dt variables
        const dt = Math.min(rawDt * this.timeScale, 0.05);
        const subSteps = 4;
        const subDt = dt / subSteps;

        for (let s = 0; s < subSteps; s++) {
            this.integrateStep(subDt);
        }

        // Actualizar visual
        this.sphere.position.copy(this.position);
        this.updateTrail();
        this.updateVectors();
        this.updateContactIndicator();

        // UI throttled
        this.uiAccumulator += rawDt;
        if (this.uiAccumulator >= this.uiInterval) {
            this.updateUI();
            this.uiAccumulator = 0;
        }
    }

    integrateStep(dt) {
        const totalForce = new THREE.Vector3(0, 0, 0);

        // 1. Gravedad: Fg = m * g
        const Fg = new THREE.Vector3(0, this.mass * this.gravity, 0);
        totalForce.add(Fg);

        // 2. Fuerza aplicada por usuario
        totalForce.add(this.appliedForce);

        // 3. Arrastre aerodinámico: Fd = -½·ρ·Cd·A·|v|²·v̂
        const vMag = this.velocity.length();
        let Fdrag = new THREE.Vector3(0, 0, 0);
        if (vMag > 0.001) {
            const A = Math.PI * this.radius * this.radius;
            const dragMag = 0.5 * this.airDensity * this.dragCoeff * A * vMag * vMag;
            Fdrag.copy(this.velocity).normalize().multiplyScalar(-dragMag);
            totalForce.add(Fdrag);
        }

        // 4. Fuerzas de contacto (suelo)
        const floorY = this.radius;
        this.isGrounded = this.position.y <= floorY + 0.02 && Math.abs(this.velocity.y) < 2.0;

        let Fnormal = 0;
        let Ffriction = new THREE.Vector3(0, 0, 0);

        if (this.position.y <= floorY + 0.1) {
            // Fuerza normal (impide penetración)
            const penetration = Math.max(0, floorY - this.position.y);
            const springK = 5000; // N/m (muy rígido para parecer sólido)
            const damping = 2 * Math.sqrt(springK * this.mass); // Crítico
            Fnormal = springK * penetration - damping * Math.min(this.velocity.y, 0);
            Fnormal = Math.max(0, Fnormal);

            if (Fnormal > 0) {
                totalForce.y += Fnormal;

                // Fricción de Coulomb
                const vHoriz = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);
                const vhMag = vHoriz.length();
                const normalMag = Fnormal; // Usamos la normal del muelle

                if (vhMag > 0.01) {
                    // Cinética
                    const fMax = this.frictionCoeff * normalMag;
                    // Limitar para no invertir velocidad en un paso
                    const maxDecel = (vhMag * this.mass) / dt;
                    const fMag = Math.min(fMax, maxDecel);
                    Ffriction.copy(vHoriz).normalize().multiplyScalar(-fMag);
                    totalForce.add(Ffriction);
                } else {
                    // Estática: cancelar fuerzas horizontales aplicadas si son menores a μN
                    const appliedHoriz = new THREE.Vector3(this.appliedForce.x, 0, this.appliedForce.z);
                    const appMag = appliedHoriz.length();
                    const fStaticMax = this.frictionCoeff * normalMag;
                    if (appMag <= fStaticMax && Math.abs(this.velocity.y) < 0.5) {
                        totalForce.x -= appliedHoriz.x;
                        totalForce.z -= appliedHoriz.z;
                        this.velocity.x = 0;
                        this.velocity.z = 0;
                    }
                }
            }
        }

        // Guardar para desglose UI
        this.lastForces.gravity = Fg.length();
        this.lastForces.normal = Fnormal;
        this.lastForces.friction = Ffriction.length();
        this.lastForces.drag = Fdrag.length();
        this.lastForces.applied = this.appliedForce.length();

        // Segunda Ley de Newton
        this.acceleration.copy(totalForce.divideScalar(this.mass));

        // Integración semi-implicita de Euler (más estable que explícita)
        this.velocity.add(this.acceleration.clone().multiplyScalar(dt));
        this.position.add(this.velocity.clone().multiplyScalar(dt));

        // Resolver colisiones (paredes y suelo duro)
        this.resolveCollisions();
    }

    resolveCollisions() {
        const floorY = this.radius;

        // Suelo
        if (this.position.y < floorY) {
            this.position.y = floorY;
            if (this.velocity.y < 0) {
                this.velocity.y *= -this.restitution;
                if (Math.abs(this.velocity.y) < 0.4) this.velocity.y = 0;
            }
        }

        // Paredes laterales
        const limit = 19;
        if (Math.abs(this.position.x) > limit) {
            this.position.x = Math.sign(this.position.x) * limit;
            if (Math.abs(this.velocity.x) > 0.1) this.velocity.x *= -this.restitution;
        }
        if (Math.abs(this.position.z) > limit) {
            this.position.z = Math.sign(this.position.z) * limit;
            if (Math.abs(this.velocity.z) > 0.1) this.velocity.z *= -this.restitution;
        }
    }

    /* ───────────────────── VISUALES ───────────────────── */

    updateTrail() {
        const show = document.getElementById('show-trail').checked;
        this.trailLine.visible = show;
        if (!show) return;

        // Buffer circular
        const idx = this.trailIndex;
        this.trailPositions[idx * 3] = this.position.x;
        this.trailPositions[idx * 3 + 1] = this.position.y;
        this.trailPositions[idx * 3 + 2] = this.position.z;

        this.trailIndex = (this.trailIndex + 1) % this.maxTrailLength;
        if (this.trailCount < this.maxTrailLength) this.trailCount++;

        this.trailGeometry.attributes.position.needsUpdate = true;
        this.trailGeometry.setDrawRange(0, this.trailCount);

        // Opacidad decreciente visual (simulada por color en el shader sería ideal,
        // pero aquí usamos un truco: recorremos para dibujar desde el índice actual)
        // Para simplicidad, mantenemos linea continua; el motion blur visual es suficiente.
    }

    updateVectors() {
        const show = document.getElementById('show-vectors').checked;
        this.vectorGroup.visible = show;
        if (!show) return;

        const base = this.position.clone();
        const scale = 0.15; // Factor visual global

        // Helper para actualizar flecha con clamping
        const updateArrow = (arrow, vec, offsetY, maxLen = 6) => {
            const mag = vec.length();
            if (mag > 0.05) {
                arrow.visible = true;
                arrow.position.copy(base).add(new THREE.Vector3(0, this.radius + 0.3 + offsetY, 0));
                arrow.setDirection(vec.clone().normalize());
                arrow.setLength(Math.min(mag * scale, maxLen), 0.25, 0.18);
            } else {
                arrow.visible = false;
            }
        };

        updateArrow(this.forceArrow, this.appliedForce, 0.0);
        updateArrow(this.velocityArrow, this.velocity, 0.6);
        updateArrow(this.accelerationArrow, this.acceleration, 1.2);

        // Vector de arrastre (opuesto a velocidad)
        const dragDir = this.velocity.clone().normalize().negate();
        const dragMag = this.lastForces.drag;
        if (dragMag > 0.01 && this.velocity.length() > 0.1) {
            this.dragArrow.visible = true;
            this.dragArrow.position.copy(base).add(new THREE.Vector3(0, this.radius + 0.3 + 1.8, 0));
            this.dragArrow.setDirection(dragDir);
            this.dragArrow.setLength(Math.min(dragMag * scale * 2, 4), 0.25, 0.18);
        } else {
            this.dragArrow.visible = false;
        }
    }

    updateContactIndicator() {
        const dist = Math.max(0, this.position.y - this.radius);
        const maxDist = 3.0;
        const intensity = Math.max(0, 1 - dist / maxDist);

        this.contactRing.position.set(this.position.x, 0.01, this.position.z);
        this.contactRing.scale.set(this.radius * 1.2, this.radius * 1.2, 1);
        this.contactRing.material.opacity = this.isGrounded ? 0.6 : intensity * 0.3;

        // Color: verde si está en reposo, naranja si se mueve en suelo
        if (this.isGrounded) {
            const moving = (this.velocity.x ** 2 + this.velocity.z ** 2) > 0.1;
            this.contactRing.material.color.setHex(moving ? 0xf59e0b : 0x10b981);
        } else {
            this.contactRing.material.color.setHex(0x10b981);
        }
    }

    /* ───────────────────── UI ───────────────────── */

    updateUI() {
        const v = this.velocity.length();
        const a = this.acceleration.length();
        const ke = 0.5 * this.mass * v * v;
        const p = this.mass * v;

        document.getElementById('velocity-display').innerHTML = `${v.toFixed(2)} <span class="unit">m/s</span>`;
        document.getElementById('acceleration-display').innerHTML = `${a.toFixed(2)} <span class="unit">m/s²</span>`;
        document.getElementById('kinetic-energy').innerHTML = `${ke.toFixed(2)} <span class="unit">J</span>`;
        document.getElementById('momentum').innerHTML = `${p.toFixed(2)} <span class="unit">kg·m/s</span>`;

        document.getElementById('vx').textContent = this.velocity.x.toFixed(2);
        document.getElementById('vy').textContent = this.velocity.y.toFixed(2);
        document.getElementById('vz').textContent = this.velocity.z.toFixed(2);

        document.getElementById('ax').textContent = this.acceleration.x.toFixed(2);
        document.getElementById('ay').textContent = this.acceleration.y.toFixed(2);
        document.getElementById('az').textContent = this.acceleration.z.toFixed(2);

        document.getElementById('pos-x').textContent = this.position.x.toFixed(2);
        document.getElementById('pos-y').textContent = this.position.y.toFixed(2);
        document.getElementById('pos-z').textContent = this.position.z.toFixed(2);

        // Badge de estado
        const badge = document.getElementById('status-badge');
        if (this.isGrounded) {
            const moving = v > 0.2;
            badge.textContent = moving ? 'En movimiento (suelo)' : 'En reposo';
            badge.className = 'status-badge grounded';
        } else {
            badge.textContent = this.velocity.y > 0 ? 'Ascendiendo' : 'Cayendo';
            badge.className = 'status-badge';
        }

        // Desglose de fuerzas
        if (document.getElementById('show-forces-breakdown').checked) {
            document.getElementById('forces-card').classList.remove('hidden');
            document.getElementById('f-gravity').textContent = this.lastForces.gravity.toFixed(2);
            document.getElementById('f-normal').textContent = this.lastForces.normal.toFixed(2);
            document.getElementById('f-friction').textContent = this.lastForces.friction.toFixed(2);
            document.getElementById('f-drag').textContent = this.lastForces.drag.toFixed(2);
            document.getElementById('f-applied').textContent = this.lastForces.applied.toFixed(2);
        } else {
            document.getElementById('forces-card').classList.add('hidden');
        }
    }

    /* ───────────────────── EVENTOS ───────────────────── */

    setupEvents() {
        // Masa
        document.getElementById('mass').addEventListener('input', (e) => {
            this.mass = parseFloat(e.target.value);
            document.getElementById('mass-value').textContent = `${this.mass.toFixed(0)} kg`;
        });

        // Radio
        document.getElementById('radius').addEventListener('input', (e) => {
            this.radius = parseFloat(e.target.value);
            document.getElementById('radius-value').textContent = `${this.radius.toFixed(1)} m`;
            this.sphere.scale.setScalar(this.radius);
            this.updateCrossSection();
        });

        // Fuerzas
        ['forceX', 'forceY', 'forceZ'].forEach(id => {
            document.getElementById(id).addEventListener('input', (e) => {
                document.getElementById(`${id}-value`).textContent = `${e.target.value} N`;
            });
        });

        document.getElementById('apply-force').addEventListener('click', () => {
            const fx = parseFloat(document.getElementById('forceX').value);
            const fy = parseFloat(document.getElementById('forceY').value);
            const fz = parseFloat(document.getElementById('forceZ').value);
            this.appliedForce.set(fx, fy, fz);

            // Feedback visual momentáneo (flash en la esfera)
            this.sphere.material.emissive.setHex(0x222222);
            setTimeout(() => this.sphere.material.emissive.setHex(0x000000), 150);
        });

        document.getElementById('reset-forces').addEventListener('click', () => {
            this.appliedForce.set(0, 0, 0);
            ['forceX', 'forceY', 'forceZ'].forEach(id => {
                document.getElementById(id).value = 0;
                document.getElementById(`${id}-value`).textContent = '0 N';
            });
        });

        // Ambientales
        document.getElementById('friction').addEventListener('input', (e) => {
            this.frictionCoeff = parseFloat(e.target.value);
            document.getElementById('friction-value').textContent = this.frictionCoeff.toFixed(2);
        });

        document.getElementById('gravity').addEventListener('input', (e) => {
            this.gravity = parseFloat(e.target.value);
            document.getElementById('gravity-value').textContent = `${this.gravity.toFixed(1)} m/s²`;
        });

        document.getElementById('restitution').addEventListener('input', (e) => {
            this.restitution = parseFloat(e.target.value);
            document.getElementById('restitution-value').textContent = this.restitution.toFixed(2);
        });

        document.getElementById('air-density').addEventListener('input', (e) => {
            this.airDensity = parseFloat(e.target.value);
            document.getElementById('air-density-value').textContent = this.airDensity.toFixed(2);
        });

        document.getElementById('time-scale').addEventListener('input', (e) => {
            this.timeScale = parseFloat(e.target.value);
            document.getElementById('time-scale-value').textContent = `${this.timeScale.toFixed(1)}×`;
        });

        // Control
        const playBtn = document.getElementById('play-pause');
        playBtn.addEventListener('click', () => {
            this.isPaused = !this.isPaused;
            playBtn.textContent = this.isPaused ? '▶ Reanudar' : '⏸ Pausar';
            playBtn.classList.toggle('btn-primary');
            playBtn.classList.toggle('btn-secondary');
        });

        document.getElementById('reset-scene').addEventListener('click', () => this.reset());

        // Color picker
        document.querySelectorAll('.color-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.objectColor = parseInt(btn.dataset.color.replace('#', ''), 16);
                this.sphere.material.color.setHex(this.objectColor);
            });
        });

        // Resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    updateCrossSection() {
        // Actualizar coeficiente de arrastre según forma (esfera siempre, pero escala con radio)
        // Cd de esfera ~ 0.47
        this.dragCoeff = 0.47;
    }

    reset() {
        this.position.set(0, 5, 0);
        this.velocity.set(0, 0, 0);
        this.acceleration.set(0, 0, 0);
        this.appliedForce.set(0, 0, 0);
        this.trailIndex = 0;
        this.trailCount = 0;
        this.trailPositions.fill(0);
        this.trailGeometry.setDrawRange(0, 0);
        this.sphere.position.copy(this.position);
        this.sphere.rotation.set(0, 0, 0);

        ['forceX', 'forceY', 'forceZ'].forEach(id => {
            document.getElementById(id).value = 0;
            document.getElementById(`${id}-value`).textContent = '0 N';
        });

        this.controls.target.copy(this.position);
        this.updateUI();
    }

    /* ───────────────────── LOOP ───────────────────── */

    animate() {
        requestAnimationFrame(() => this.animate());

        const dt = Math.min(this.clock.getDelta(), 0.1);

        if (dt > 0) {
            this.updatePhysics(dt);
        }

        // Rotación visual proporcional al desplazamiento (rolling sin deslizamiento)
        if (!this.isPaused && this.velocity.length() > 0.01) {
            const axis = new THREE.Vector3(this.velocity.z, 0, -this.velocity.x).normalize();
            const angle = this.velocity.length() * dt / this.radius;
            this.sphere.rotateOnWorldAxis(axis, angle);
        }

        // Cámara sigue al objeto
        if (document.getElementById('camera-follow').checked) {
            const offset = new THREE.Vector3(12, 10, 12);
            const targetPos = this.position.clone().add(offset);
            this.camera.position.lerp(targetPos, 0.05);
            this.controls.target.lerp(this.position, 0.1);
        }

        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}

// Inicializar cuando DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new PhysicsSimulator());
} else {
    new PhysicsSimulator();
}