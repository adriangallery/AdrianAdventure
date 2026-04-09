import { Verb, ALL_VERBS } from '@/types/game.types';

export class VerbSystem {
  private selectedVerb: Verb = Verb.LOOK;
  private availableVerbs: Verb[] = ALL_VERBS;

  select(verb: Verb): void {
    if (this.availableVerbs.includes(verb)) {
      this.selectedVerb = verb;
    }
  }

  getSelected(): Verb {
    return this.selectedVerb;
  }

  getAvailable(): Verb[] {
    return [...this.availableVerbs];
  }

  setAvailable(verbs: Verb[]): void {
    this.availableVerbs = verbs;
    if (!this.availableVerbs.includes(this.selectedVerb)) {
      this.selectedVerb = this.availableVerbs[0] ?? Verb.LOOK;
    }
  }

  reset(): void {
    this.selectedVerb = Verb.LOOK;
    this.availableVerbs = ALL_VERBS;
  }
}
