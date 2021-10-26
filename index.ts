import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

const vpc = new awsx.ec2.Vpc("pk-neptune-vpc", {
    subnets: [{
        type: "public",
        name: "publicneptune"
    }],
    tags: {
        Name: "neptune-vpc"
    }
});

const neptuneSubnetGroup = new aws.neptune.SubnetGroup("neptunesubnetgroup", {
    subnetIds: vpc.publicSubnetIds
});

const parameterGroup = new aws.neptune.ClusterParameterGroup("parametergroup", {
    family: "neptune1",
    parameters: [{
        name: "neptune_autoscaling_config",
        value: JSON.stringify({
            "dbInstanceClass": "db.r5.large"
        })
    }],
    description: "auto-scaling"
});

const neptuneClusterSecurityGroup = new aws.ec2.SecurityGroup("neptune-cluster-secgrp", {
    vpcId: vpc.id,
    ingress: [{
        protocol: "tcp",
        fromPort: 8182,
        toPort: 8182,
        self: true
    }],
});

const db = new aws.neptune.Cluster("db", {
    clusterIdentifier: "neptunedb",
    engine: "neptune",
    skipFinalSnapshot: true,
    neptuneClusterParameterGroupName: parameterGroup.name,
    neptuneSubnetGroupName: neptuneSubnetGroup.name,
    vpcSecurityGroupIds: [neptuneClusterSecurityGroup.id],
});


for (let i = 0; i < 2; i++) {
    new aws.neptune.ClusterInstance(`neptuneinstance-${i}`, {
        clusterIdentifier: db.clusterIdentifier,
        promotionTier: 0,
        instanceClass: "db.r5.large",
        neptuneSubnetGroupName: neptuneSubnetGroup.name,
        publiclyAccessible: false,
        identifier: `neptuneinstance-${i}`,
    });
}

const config = new pulumi.Config();

const autoScalingTarget = new aws.appautoscaling.Target("target", {
    serviceNamespace: "neptune",
    resourceId: pulumi.interpolate`cluster:${db.clusterIdentifier}`,
    scalableDimension: "neptune:cluster:ReadReplicaCount",
    minCapacity: config.requireNumber("minInstances"),
    maxCapacity: config.requireNumber("maxInstances")
});

const autoScalingPolicy = new aws.appautoscaling.Policy("policy", {
    policyType: "TargetTrackingScaling",
    serviceNamespace: autoScalingTarget.serviceNamespace,
    scalableDimension: autoScalingTarget.scalableDimension,
    resourceId: autoScalingTarget.resourceId,
    targetTrackingScalingPolicyConfiguration: {
        predefinedMetricSpecification: {
            predefinedMetricType: "NeptuneReaderAverageCPUUtilization",
        },
        targetValue: 80,
        scaleInCooldown: 600,
        scaleOutCooldown: 600
    }
});