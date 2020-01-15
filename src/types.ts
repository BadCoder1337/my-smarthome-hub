export type Bind = [string, number] | { [s: string]: 'on' | 'off' };

export interface ICfg {
    to: Bind[];
    from: string[][];
}

export interface IRF {
    Time: string;
    RfReceived: {
        Sync: number;
        Low: number;
        High: number;
        Data: string;
        RfKey: string;
    };
}
