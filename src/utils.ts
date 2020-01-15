import { IHost } from 'ewelink-api';
import fetch from 'node-fetch';
import { linuxARP, win32ARP } from './arp';
import { ICfg } from './types';

export function ipToBin(ip: string) {
    return ip.split('.').map(octet => parseInt(octet).toString(2).padStart(8, '0')).join('');
}

export function binToIp(bin: string) {
    bin = bin.padStart(32, '0');
    return new Array(4).fill(null).map((_, i) => bin.slice(i * 8, i * 8 + 8)).map(octet => parseInt(octet, 2)).join('.');
}

export async function loadCodes(): Promise<[ICfg, Map<string, number>]> {
    const codeMap = new Map<string, number>();
    const res = await fetch(process.env.CONFIG_URL);
    const cfg = await res.json() as ICfg;
    cfg.from.map((codeArr: string[], i: number) => {
        codeArr.map(code => codeMap.set(code, i));
    });
    return [cfg, codeMap];
}

export async function getArpTable(): Promise<IHost[]> {
    switch (process.platform) {
        case 'win32': return win32ARP();
        case 'linux':
        default: return linuxARP();
    }
}
