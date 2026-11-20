# Port Solara Streets · 索拉港街頭

[繁體中文](README.md) | **English**

A 3D open-world crime action sandbox that runs in the browser. Drive, fight, shake off the police, and rise from street kid to legend of Port Solara.

No install, no login, no external assets. Every model, texture, sound effect and radio track is generated in code at runtime.

---

## Features

### Graphics
- **Day/night cycle and weather**: physical sky, sun/moon lighting with real-time shadows, stars, lit windows, street lamps and neon billboards at night. Random rain makes roads wet and reflective and the sky overcast; storms bring lightning and thunder, and wet roads reduce grip.
- **Detailed regions**: downtown storefronts with signs and awnings (lit at night), bus stops, hydrants, bins, planters and manholes; hedges, mailboxes and backyard pools in the suburbs; smoking chimneys, storage tanks and pallets in the industrial district; a freight train, floodlights, forklifts and tugboats at the harbour; lifeguard towers, volleyball nets, sunbeds and food kiosks on the beach; conifer forests, boulders, campfires and a lookout tower in the mountains and by the lake; mesas, a trailer park, windpumps and telegraph lines in the desert; boardwalks, porches, a church and a neon motel sign in Dustwater; fences, jet bridges, baggage carts, a fuel truck, a windsock and a spinning radar at the airport; power pylons and guardrails along the highway, and farmland with silos in the west.
- **Post-processing**: bloom, ACES tone mapping, colour grading, vignette, SMAA and GTAO ambient occlusion (high quality). Taking damage or using slow motion adds chromatic aberration and desaturation.
- **Sky and water**: a drifting cloud layer (tinted at sunset, heavier in rain) and a sun lens flare; sea and lake water shade from turquoise shallows to deep blue, with foam along the shore.
- **Surface detail**: building facades have normal-mapped, recessed windows; wind-swept grass grows on lawns and fields near the camera; cars have licence plates, door seams and spoked rims; characters have sculpted bodies (male and female builds of varying height and weight), faces, fingers and shoe soles, with jackets, short sleeves, shorts, skirts, caps, sunglasses, watches, backpacks, chains and beards; buildings have floor ledges, cornices, 3D balconies, rooftop machinery, satellite dishes and glowing crowns at night, houses have chimneys, porches, garage doors and solar panels, and downtown streets are lined with trees.
- **A roughly 4 × 4 km island**: the 8×8-block city of Port Solara (downtown, residential, industrial and seaside districts, harbour and beach) surrounded by snow-capped northern mountains with a relay tower, a lake in the forest, a western desert with the town of Dustwater, and an international airport, all linked by a ring highway. Building facades are procedurally painted and light up at night.
- **Vehicles and characters**: extruded-profile car bodies with clear-coat reflections; drivers and passengers are visible through the windows. Characters use an animated skeleton (walk, run, aim, fall).
- **Flyable helicopters** at the airport and hospital helipads: Space climbs, Shift descends, and you can land on rooftops.
- **Particles**: muzzle flashes, tracers, bullet holes, sparks, blood, fireballs, smoke, tyre smoke and skid marks.

### Feel
- Over-the-shoulder third-person camera, zoom when aiming, first-person sniper scope.
- Recoil, crosshair bloom, hit and kill markers, camera shake.
- Arcade driving with weight, handbrake drifts, body roll, ramp jumps, collision damage, fires and explosions.
- You can shoot a pistol or SMG from a car. Press `Q` for adrenaline slow motion.
- Characters react when they are shot.
- **Phones and tablets**: a floating joystick on the left, drag on the right to look, and on-screen buttons to shoot, aim, jump and enter vehicles (play in landscape).

### Content
- **6-chapter story**: homecoming, debt collection, a car theft, a harbour ambush, an armoured-truck heist and a bank job.
- **1–5 level heat system**: pursuit cars that ram you, officers who get out and surround you, SWAT vans, and a police helicopter with a searchlight that you can shoot down. Break line of sight and leave the search zone to escape.
- **Side activities**: 5 races including a ring-highway race and a runway drag race (gold/silver/bronze), courier delivery jobs, 9 stunt jumps, 30 hidden cassette tapes, convenience-store robberies, and armoured trucks that appear at random.
- **Shops**: gun store (8 weapons, ammo, body armour), Han's Garage (repair; a respray clears heat) and a safehouse (save, sleep).
- **Living world**: pedestrians who cross the street, lane-following traffic on every road (faster on highways), civilians who flee from gunfire, and visitors around the town, airport, beach and lake.
- **UI**: a rotating radar with island-wide GPS routing, a full map you can zoom, drag and click to set a waypoint, a weapon wheel, progress stats and saving.
- **Audio**: guns, engines, sirens and ambience synthesised with Web Audio, plus two in-car radio stations.

## Controls

| Key | Action |
| --- | --- |
| `WASD` | Move / drive |
| Mouse | Look |
| LMB / RMB | Shoot / aim |
| `Shift` | Sprint |
| `Space` | Jump / handbrake / helicopter climb |
| `Shift` / `Ctrl` (helicopter) | Descend |
| `F` | Enter, exit or hijack a vehicle |
| `E` | Interact (shops, missions, races, deliveries) |
| `R` | Reload |
| `Tab` (hold) | Weapon wheel (slow motion) |
| `1`–`8` / wheel | Switch weapon |
| `Q` | Adrenaline slow motion |
| `M` | Map (click to set a waypoint) |
| `V` | Change camera distance |
| `H` | Horn / police siren |
| `B` | Change radio station |
| `Esc` | Pause and settings |

## Quick start

```bash
git clone https://github.com/richie7p/los-santos-lite.git
cd los-santos-lite
npm install
npm run dev
```

Open <http://localhost:8080>. Run `npm test` for the automated tests; `npm run build` type-checks, tests and bundles into `dist/`. A desktop browser with mouse and keyboard works best. If the game stutters, lower the graphics quality in the pause menu.

## License

MIT License. See [LICENSE](LICENSE). This is an original work; its city, characters and brands are fictional.
