// Rapier interaction groups: upper 16 bits = memberships, lower 16 bits = filter.
export const G_GROUND = 1 << 0; // road + sidewalks (wheel ray targets)
export const G_STATIC = 1 << 1; // buildings, barriers, props
export const G_PLAYER = 1 << 2;
export const G_TRAFFIC = 1 << 3;
export const G_CAMERA = 1 << 4; // camera-only blockers (tree canopies); never collide with bodies
export const G_QUERY = 1 << 15; // membership used only by scene queries (camera rays)

export const groups = (membership: number, filter: number) => ((membership & 0xffff) << 16) | (filter & 0xffff);

export const GROUND_GROUPS = groups(G_GROUND, 0xffff);
export const STATIC_GROUPS = groups(G_STATIC, 0xffff);
export const PLAYER_GROUPS = groups(G_PLAYER, G_GROUND | G_STATIC | G_TRAFFIC);
export const TRAFFIC_GROUPS = groups(G_TRAFFIC, G_PLAYER);
/** Wheel raycasts only hit the drivable ground. */
export const GROUND_QUERY_GROUPS = groups(0xffff, G_GROUND);
/** Camera obstruction rays hit buildings only. */
export const CAMERA_QUERY_GROUPS = groups(G_QUERY, G_STATIC | G_CAMERA);
/** Interaction tests are symmetric: these colliders accept only query rays, never bodies. */
export const CAMERA_ONLY_GROUPS = groups(G_CAMERA, G_QUERY);
