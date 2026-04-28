---
subcategory: "EKS"
---

# Resource: aws_eks_cluster

Manages an EKS Cluster.

## Example Usage

```terraform
resource "aws_eks_cluster" "example" {
  name     = "my-cluster"
  role_arn = aws_iam_role.example.arn

  vpc_config {
    subnet_ids = ["subnet-123", "subnet-456"]
  }
}
```

## Argument Reference

* `name` - (Required) Name of the cluster.
* `role_arn` - (Required) ARN of the IAM role.
* `vpc_config` - (Required) Configuration block for the VPC associated with your cluster.

### vpc_config Block

* `subnet_ids` - (Required) List of subnet IDs.
* `endpoint_public_access` - (Optional) Whether the public API endpoint is enabled.

## Import

```sh
terraform import aws_eks_cluster.example my-cluster
```
