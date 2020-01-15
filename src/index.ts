import * as dotenv from 'dotenv';
dotenv.config();
import * as MQTTBroker from 'async-mqtt';
import { exec, execSync } from 'child_process';
import { eWeLink, IHost, Zeroconf } from 'ewelink-api';
import fetch from 'node-fetch';

type Bind = [string, number] | { [s: string]: 'on' | 'off' };

interface ICfg {
    to: Bind[];
    from: string[][];
}

interface IRF {
    Time: string;
    RfReceived: {
        Sync: number;
        Low: number;
        High: number;
        Data: string;
        RfKey: string;
    };
}

const mqtt = MQTTBroker.connect(process.env.MQTT_URL, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD
});

function ipToBin(ip: string) {
    return ip.split('.').map(octet => parseInt(octet).toString(2).padStart(8, '0')).join('');
}

function binToIp(bin: string) {
    bin = bin.padStart(32, '0');
    return new Array(4).fill(null).map((_, i) => bin.slice(i * 8, i * 8 + 8)).map(octet => parseInt(octet, 2)).join('.');
}

async function getArpTable(): Promise<IHost[]> {
    switch (process.platform) {
        case 'win32': {
            const output = execSync('pwsh ./scripts.ps1').toString();
            const netNeighbor = JSON.parse(output);
            return netNeighbor.map(nn => ({ ip: (nn.IPAddress as string), mac: (nn.LinkLayerAddress as string).toLowerCase().replace(/-/g, ':')}));
        }
        case 'linux':
        default: {
            const output1 = execSync('ifconfig | grep -i "inet " | grep -v "127."')
                .toString()
                .split('\n')
                .filter(Boolean)
                .map(s => s.split('  ').filter(Boolean).map(ss => ss.split(' ')[1]));
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
    }
}

async function getDevices() {
    try {
        return Zeroconf.loadCachedDevices();
    } catch (error) {
        const ewe = new eWeLink({
            region: process.env.EWELINK_REGION || 'eu',
            email: process.env.EWELINK_EMAIL,
            password: process.env.EWELINK_PASSWORD,
        });
        await ewe.saveDevicesCache();
        return Zeroconf.loadCachedDevices();
    }
}

async function loadCodes(): Promise<[ICfg, Map<string, number>]> {
    const codeMap = new Map<string, number>();
    const res = await fetch(process.env.CONFIG_URL);
    const cfg = await res.json() as ICfg;
    cfg.from.map((codeArr: string[], i: number) => {
        codeArr.map(code => codeMap.set(code, i));
    });
    return [cfg, codeMap];
}

async function main() {
    const [cfg, codeMap] = await loadCodes();
    console.log('[1/4] Codes loaded!');
    const arpTable = await getArpTable();
    console.log('[2/4] ARP table loaded!');
    const devicesCache = await getDevices();
    console.log('[3/4] Cached devices loaded!');
    const ewe = new eWeLink({arpTable, devicesCache});
    console.log('[4/4] Ready!');

    await mqtt.subscribe('tele/tasmota/#');
    mqtt.on('message', async (topic: string, payload: Buffer) => {
        if (topic !== 'tele/tasmota/RESULT') { return; }
        const msg = JSON.parse(payload.toString()) as IRF;
        const i = codeMap.get(msg.RfReceived.Data);
        const newState = cfg.to[i];
        console.log(i, newState, msg.RfReceived.Data);
        console.log(await (newState
            && (newState instanceof Array
                ? ewe.toggleDevice(...newState)
                : Promise.all(Object.entries(newState).map(ent => ewe.setDevicePowerState(ent[0], ent[1].toString())))
            )
        ));
    });
}

main();
