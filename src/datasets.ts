// Built-in round sources that need no editor setup.

export interface BuiltinDataset {
  name: string;
  prompt: string;
  items: { title: string; rating: number }[];
}

export const BUILTIN_DATASETS: Record<string, BuiltinDataset> = {
  movies: {
    name: "Built-in: Worst movies",
    prompt: "Find the lowest-rated movie.",
    items: [
      { title: "The Room (2003)", rating: 3.7 },
      { title: "Batman & Robin (1997)", rating: 3.8 },
      { title: "Cats (2019)", rating: 2.8 },
      { title: "Battlefield Earth (2000)", rating: 2.5 },
      { title: "Jack and Jill (2011)", rating: 3.1 },
      { title: "Movie 43 (2013)", rating: 3.0 },
      { title: "The Last Airbender (2010)", rating: 4.0 },
      { title: "Gigli (2003)", rating: 2.6 },
      { title: "Wild Wild West (1999)", rating: 4.3 },
      { title: "Twilight (2008)", rating: 5.3 },
      { title: "Morbius (2022)", rating: 5.2 },
    ],
  },
};
