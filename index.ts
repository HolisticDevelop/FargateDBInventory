import {RDS, SecretsManager} from "aws-sdk";
import {ClusterService} from "./ClusterService";
import {RDSCluster} from "./entities/RDSCluster";
import * as fs from "fs";



const config = {region: "us-east-1"}

async function getClusters() {
    const rds = new RDS(config);
    let clusters: RDS.DBClusterList | undefined;
    await rds.describeDBClusters({}, (err, data) => {
        if (err) throw new Error(err.toString()); // an error occurred
        else clusters = data.DBClusters;        // successful response
    }).promise();
    return clusters;
}

async function getSecretList() {
    const secretsManager = new SecretsManager(config);
    let secretList: SecretsManager.SecretListType | undefined;
    await secretsManager.listSecrets({}, (err, data) => {
        if (err) throw new Error(err.toString());
        else secretList = data.SecretList;
    }).promise();
    return secretList ? secretList : [];
}

async function getSecrets(clusters: RDS.DBClusterList) {
    const secretsManager = new SecretsManager(config);
    const secretList = await getSecretList();
    let results: any[] = [];

    // let secrets: Map<string, Secret | undefined> = new Map();
    // for await (const c of clusters) dbs.set(<string>c.Endpoint, undefined);
    // const secretList = await getSecretList();

    for await (const secret of secretList) {
        const params = {
            "SecretId": secret.ARN ? secret.ARN : ""
        }
        await secretsManager.getSecretValue(params, (err, data) => {
            let secret = JSON.parse(<string>data.SecretString);
            results.push(secret);
        }).promise();
    }
    return results;
}

async function main() {
    console.log("Listing secrets...");

    const clusterList = await getClusters();
    let dbs: Map<RDS.DBCluster, any> = new Map();
    // mapCluster = clusterList?.map(c => mapCluster.set(c.Endpoint, undefined))
    if (clusterList) {
        const secretList = await getSecrets(clusterList);
        for (const c of clusterList){
            const matchSecret = secretList.find(s => s.host == c.Endpoint);
            dbs.set(c, matchSecret)
        }
    }

    let finalData: RDSCluster[] = [];
    for (const [k, v] of dbs.entries()) {
        if (v != undefined){
            const clusterService = new ClusterService(
                <string>k.DBClusterIdentifier,
                <string>k.Endpoint,
                v.username || v.user,
                v.password,
                <string>k.Engine);
            await clusterService.getCluster()
                .then(r => finalData.push(r))
                .catch(e => console.log(e));

        }else finalData.push({
            name: <string>k.DBClusterIdentifier,
            host: <string>k.Endpoint,
            engine: <string>k.Engine,
            users: "Couldn't get secret for this cluster",
            databases: "Couldn't get secret for this cluster"
        });
    }


    let data = JSON.stringify(finalData);
    fs.writeFileSync('inventory.json', data);


    // console.log(finalData);
    console.table(finalData);


    console.log("End...")
}

main();




