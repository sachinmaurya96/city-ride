/** Imported player/passenger characters (GLB models), in menu order. */
export const CHARACTER_IDS = ['male', 'female', 'lynae', 'cartethyia', 'carlotta', 'chisa', 'zani', 'shorekeeper', 'mint', 'phoebe'] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];
/** Ride passengers: every imported character except the two Rovers (the player's own characters). */
export const PASSENGER_CHARACTER_IDS = ['lynae', 'cartethyia', 'carlotta', 'chisa', 'zani', 'shorekeeper', 'mint', 'phoebe'] as const;
export type PassengerCharacterId = (typeof PASSENGER_CHARACTER_IDS)[number];

export const CHARACTER_NAMES: Record<CharacterId, string> = {
  male: 'Male Rover', female: 'Female Rover', lynae: 'Lynae', cartethyia: 'Cartethyia',
  carlotta: 'Carlotta', chisa: 'Chisa', zani: 'Zani', shorekeeper: 'Shorekeeper', mint: 'Mint', phoebe: 'Phoebe',
};
export const CHARACTER_GENDER: Record<CharacterId, 'male' | 'female'> = {
  male: 'male', female: 'female', lynae: 'female', cartethyia: 'female',
  carlotta: 'female', chisa: 'female', zani: 'female', shorekeeper: 'female', mint: 'female', phoebe: 'female',
};

export const isPassengerCharacter = (value: string): value is PassengerCharacterId => (PASSENGER_CHARACTER_IDS as readonly string[]).includes(value);
