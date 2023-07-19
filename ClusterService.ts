import * as mysql from "mysql";
import {Database} from "./entities/Database";
import {RDSCluster} from "./entities/RDSCluster";
import {User} from "./entities/User";
import {Client} from 'pg';
import {data} from "aws-cdk/lib/logging";
import * as querystring from "querystring";

export class ClusterService {

    private name: string;
    private host: string;
    private user: string;
    private password: string;
    private engine: string;
    private connection: mysql.Connection | Client;

    constructor(name: string, host: string, user: string, password: string, engine: string) {
        this.name = name;
        this.host = host;
        this.user = user;
        this.password = password;
        this.engine = engine;

        if (engine.includes('mysql'))
            this.connection = mysql.createConnection({
                host: this.host,
                user: this.user,
                password: this.password
            });
        else if (engine.includes('postgres'))
            this.connection = new Client({
                host: this.host,
                user: this.user,
                password: this.password,
                database: 'postgres'
            });
    }

    public async getDatabases(): Promise<Database[]> {
        let query: string;
        if (this.connection instanceof Client) query = 'SELECT datname FROM pg_database WHERE datistemplate = false';
        else query = 'SHOW databases';
        // const query: string = 'SHOW databases';
        // const query2: string = '\l';
        return new Promise(async (resolve, reject) => {

            // @ts-ignore
            this.connection.query(query, async (err, results, fields) => {
                if (err) return reject(err);
                let databases: Database[] = [];

                if (this.connection instanceof Client) {
                    // @ts-ignore
                    databases = results.rows.map(r => r['datname']);
                }else {
                    // @ts-ignore
                    databases = results.map(r => r.Database).filter(d => !["mysql", "sys", "information_schema", "performance_schema"].includes(d)).map(d => {
                        return {name: d}
                    });
                }
                resolve(databases);
            });

        });
    }


    public async getCluster(): Promise<RDSCluster> {

        return new Promise(async (resolve, reject) => {
            try {
                await this.connection.connect();
                const databases = await this.getDatabases();
                const users: User[] = await this.getUsers();
                const cluster: RDSCluster = {
                    name: this.name,
                    host: this.host,
                    users: users,
                    databases: databases,
                    engine: this.engine
                }
                await this.connection.end();
                resolve(cluster);
            }catch (e) {
                resolve({
                    name: this.name,
                    host: this.host,
                    users: "Bad credentials for this cluster.",
                    databases: "Bad credentials for this cluster.",
                    engine: this.engine
                })
            }
        });
    }

    public async getUsers(): Promise<User[]> {
        let query: string;
        if (this.connection instanceof Client) query = "SELECT\n" +
            "  r.rolname,\n" +
            "  CONCAT(\n" +
            "    'is_superuser: ', r.rolsuper::text, \n" +
            "    ', can_inherit: ', r.rolinherit::text, \n" +
            "    ', can_create_role: ', r.rolcreaterole::text,\n" +
            "    ', can_create_db: ', r.rolcreatedb::text,\n" +
            "    ', can_login: ', r.rolcanlogin::text,\n" +
            "    ', connection_limit: ', r.rolconnlimit::text,\n" +
            "    ', valid_until: ', r.rolvaliduntil::text,\n" +
            "    ', is_replication: ', r.rolreplication::text,\n" +
            "    ', bypass_rls: ', r.rolbypassrls::text\n" +
            "  ) AS privileges\n" +
            "FROM pg_catalog.pg_roles r\n" +
            "WHERE r.rolname !~ '^pg_'\n" +
            "ORDER BY 1;\n" // 'SELECT usename FROM pg_user';
        else query = `SELECT user FROM mysql.user`;
        return new Promise(async (resolve, reject) => {

            // @ts-ignore
            this.connection.query(query, async (err, results, fields) => {
                if (err) return reject(err);
                let users: User[] = [];
                if (this.connection instanceof Client){
                    // @ts-ignore
                    users = results.rows.map(r => { return {name: r['rolname'], permissions: r['privileges']}}).filter(u => !u.name.includes('rds'));
                }else {
                    // @ts-ignore
                    users = results.map(u => u.user).filter(u => !["rdsadmin", "mysql.sys"].includes(u));
                    // @ts-ignore
                    users = await Promise.all(users.map(async (u): Promise<User> => {return {name: u, permissions: await this.getPermissions(u)}
                    })); //results.map(r => r.Database).filter(d => !["mysql", "sys", "information_schema", "performance_schema"].includes(d)).map(d => {return {name: d, users: []}});)
                }

                resolve(users);
            });

        });
    }

    public async getPermissions(user: string): Promise<string> {
        const query: string = `SHOW GRANTS FOR '${user}'`;
        return new Promise((resolve, reject) => {
            // @ts-ignore
            this.connection.query(query, async (err, results, fields) => {
                if (err) return reject(err);
                // console.log(results);
                // @ts-ignore
                const permissions: string = Object.values(results[0])[0];
                resolve(permissions);
            });

        });
    }
}