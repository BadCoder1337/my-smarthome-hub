import * as dotenv from 'dotenv';
dotenv.config();
import * as MQTTBroker from 'async-mqtt';
import { execSync } from 'child_process';
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

async function getArpTable(): Promise<IHost[]> {
    if (process.platform === 'win32') {
        const output = execSync('pwsh -Command "'
        + 'Get-NetNeighbor |'
        + 'ForEach-Object -ThrottleLimit 256 -Parallel { if (Test-Connection $_.IPAddress -Ping -Quiet) { $_ } else { $null } } |'
        + 'Where-Object { $_ -ne $null } |'
        + 'ConvertTo-Json |'
        + 'Out-Host'
        + '"').toString();
        const netNeighbor = JSON.parse(output);
        return netNeighbor.map(nn => ({ ip: (nn.IPAddress as string), mac: (nn.LinkLayerAddress as string).toLowerCase().replace(/-/g, ':')}));
    } else {
        return Zeroconf.getArpTable(process.env.MY_IP);
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
