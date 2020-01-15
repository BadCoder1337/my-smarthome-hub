import { exec, execSync } from 'child_process';
import { IHost } from 'ewelink-api';
import { binToIp, ipToBin } from './utils';

export async function win32ARP(): Promise<IHost[]> {
    const output = execSync('pwsh ./scripts/arp.ps1').toString();
    const netNeighbor = JSON.parse(output);
    return netNeighbor.map(nn => ({ ip: (nn.IPAddress as string), mac: (nn.LinkLayerAddress as string).toLowerCase().replace(/-/g, ':')}));
}

export async function linuxARP(): Promise<IHost[]> {
    const output1 = execSync('ifconfig | grep -i "inet " | grep -v "127."')
        .toString()
        .split('\n')
        .filter(Boolean)
        .map(s => s.split('  ')
            .filter(Boolean)
            .map(ss => ss.split(' ')[1])
        );
    const ips = output1.map(o => {
        // tslint:disable:no-bitwise
        const ip = ipToBin(o[0]);
        const mask = ipToBin(o[1]);
        const block = mask.slice(0, mask.indexOf('0')).length;
        const start = ((parseInt(ip, 2) & parseInt(mask, 2)) >>> 0) + 1;
        const range = new Array((1 << (32 - block)) - 2).fill(null).map((_, i) => binToIp((start + i).toString(2)));
        return range;
    }).reduce((a, b) => [...a, ...b]);
    await Promise.all(ips.map(ip => new Promise<string>(res => exec(`ping ${ip} -c 1 -4`, (_, stdout) => res(stdout)))));
    const arp = execSync('ip neigh | grep -v "FAILED"')
        .toString()
        .split('\n')
        .filter(Boolean)
        .map(ip => ip.split(' '))
        .map(ip => ({ ip: ip[0], mac: ip[4] }));
    return arp;
}
