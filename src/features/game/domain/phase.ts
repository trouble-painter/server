export enum PhaseType {
  Wait = 'wait',
}

export type Phase = { readonly type: PhaseType.Wait };
