/** Shared enforcement state read by missions/HUD; owned and updated by the violations/police systems. */
export const enforcement = {
  heat: 0,
  pursuit: false,
  /** Tutorial protection: ordinary mistakes are warnings only. */
  protectedRides: 2,
  /** Incidents (violations/crashes) since the current job started — makes the job "not clean". */
  jobIncidents: 0,
};
